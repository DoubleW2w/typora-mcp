import type { Locator } from "playwright-core";
import {
  closeTyporaProcess,
  listTyporaProcesses,
  TyporaProcessManager,
  type LaunchOptions,
} from "./typora-process.js";
import { TyporaSession, TyporaSessionError } from "./typora-session.js";

export class TyporaToolError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "TyporaToolError";
  }
}

export function selectElementIndex(count: number, index?: number): number {
  if (count === 0) throw new TyporaToolError("SELECTOR_NOT_FOUND", "The selector matched no elements");
  if (index === undefined && count > 1) {
    throw new TyporaToolError("SELECTOR_AMBIGUOUS", `The selector matched ${count} elements; pass index`);
  }
  const selected = index ?? 0;
  if (!Number.isInteger(selected) || selected < 0 || selected >= count) {
    throw new TyporaToolError("SELECTOR_NOT_FOUND", `Element index ${selected} is outside ${count} matches`);
  }
  return selected;
}

export function truncateText(value: string, maxChars: number) {
  return {
    value: value.slice(0, maxChars),
    truncated: value.length > maxChars,
    originalChars: value.length,
  };
}

export class TyporaTools {
  readonly process: TyporaProcessManager;
  readonly session: TyporaSession;

  constructor(processManager = new TyporaProcessManager(), session = new TyporaSession()) {
    this.process = processManager;
    this.session = session;
  }

  async status() {
    const processStatus = this.process.status();
    let processes: Awaited<ReturnType<typeof listTyporaProcesses>> = [];
    const warnings: string[] = [];
    try {
      processes = await listTyporaProcesses();
    } catch (error) {
      warnings.push(`Could not inspect operating-system processes: ${messageOf(error)}`);
    }

    if (!this.session.connected && (processStatus.running || processes.length > 0)) {
      const endpoint = processStatus.endpoint ?? process.env.TYPORA_CDP_ENDPOINT ?? "http://127.0.0.1:9222";
      try {
        await this.session.connect(endpoint, 750);
      } catch (error) {
        warnings.push(messageOf(error));
      }
    }

    const targets = this.session.connected ? await this.session.targets() : [];
    const focused = targets.filter((target) => target.focused);
    return {
      running: processStatus.running || processes.length > 0,
      owned: processStatus.owned,
      pid: processStatus.pid ?? processes[0]?.pid ?? null,
      processes,
      executablePath: processStatus.executablePath,
      rendererConnected: this.session.connected,
      cdpEndpoint: this.session.endpoint ?? processStatus.endpoint,
      targets,
      activeTargetId: focused.length === 1 ? focused[0]!.targetId : null,
      currentFile: processStatus.filePath
        ? { path: processStatus.filePath, source: "launch-argument", confidence: "high" }
        : null,
      latestDebugSeq: this.session.observer.latestSeq(),
      warnings,
    };
  }

  async launch(options: LaunchOptions & { restartIfNeeded?: boolean } = {}) {
    const before = await this.status();
    if (before.running && !before.rendererConnected) {
      if (!options.restartIfNeeded) {
        throw new TyporaToolError(
          "TYPORA_RUNNING_WITHOUT_CDP",
          "Typora is already running without a reachable CDP endpoint; close it or relaunch with restartIfNeeded",
        );
      }
      if (this.process.status().running) await this.process.close(false);
      else await Promise.all(before.processes.map((item) => closeTyporaProcess(item.pid)));
      const stopped = await waitForNoTyporaProcesses(5_000);
      if (!stopped) {
        throw new TyporaToolError(
          "TYPORA_CLOSE_PENDING",
          "Typora is still open, possibly because it is waiting for an unsaved-document decision",
        );
      }
    }
    const launched = await this.process.launch(options);
    const endpoint = launched.endpoint!;
    const deadline = Date.now() + 15_000;
    let lastError: unknown;
    while (Date.now() < deadline) {
      try {
        await this.session.connect(endpoint, 1_000);
        return await this.status();
      } catch (error) {
        lastError = error;
        await delay(200);
      }
    }
    throw new TyporaToolError("CDP_UNREACHABLE", `Typora started but CDP did not become ready: ${messageOf(lastError)}`);
  }

  async close(force = false) {
    if (!force && this.session.connected) {
      await this.session.closeApplication();
      await delay(250);
    } else {
      await this.process.close(force);
    }
    return await this.status();
  }

  async reload(targetId?: string, ignoreCache = false) {
    await this.session.reload(targetId, ignoreCache);
    return { reloaded: true, targets: await this.session.targets() };
  }

  async getDom(options: {
    targetId?: string;
    selector?: string;
    format?: "html" | "text" | "accessibility";
    maxChars?: number;
  }) {
    const page = await this.session.page(options.targetId);
    const locator = page.locator(options.selector ?? "html");
    const index = selectElementIndex(await locator.count());
    const selected = locator.nth(index);
    const format = options.format ?? "html";
    const value =
      format === "text"
        ? await selected.innerText()
        : format === "accessibility"
          ? await selected.ariaSnapshot()
          : await selected.evaluate((element) => element.outerHTML);
    return { selector: options.selector ?? "html", format, ...truncateText(value, options.maxChars ?? 50_000) };
  }

  async querySelector(options: { targetId?: string; selector: string; limit?: number }) {
    const page = await this.session.page(options.targetId);
    const locator = page.locator(options.selector);
    const count = await locator.count();
    const limit = options.limit ?? 50;
    const elements = await locator.evaluateAll(
      (matches, max) =>
        matches.slice(0, max).map((element, index) => {
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return {
            index,
            tag: element.tagName.toLowerCase(),
            text: (element.textContent ?? "").trim().slice(0, 500),
            attributes: Object.fromEntries([...element.attributes].map((attribute) => [attribute.name, attribute.value])),
            visible: rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none",
            rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          };
        }),
      limit,
    );
    return { selector: options.selector, count, elements, truncated: count > limit };
  }

  async getElement(options: {
    targetId?: string;
    selector: string;
    index?: number;
    includeStyles?: boolean;
    includeListeners?: boolean;
    includeAccessibility?: boolean;
  }) {
    const page = await this.session.page(options.targetId);
    const locator = page.locator(options.selector);
    const index = selectElementIndex(await locator.count(), options.index);
    const selected = locator.nth(index);
    const element = await selected.evaluate((node, includeStyles) => {
      const rect = node.getBoundingClientRect();
      const computed = getComputedStyle(node);
      const styles = includeStyles
        ? Object.fromEntries([...computed].map((name) => [name, computed.getPropertyValue(name)]))
        : undefined;
      return {
        tag: node.tagName.toLowerCase(),
        text: (node.textContent ?? "").trim().slice(0, 2_000),
        html: node.outerHTML.slice(0, 20_000),
        attributes: Object.fromEntries([...node.attributes].map((attribute) => [attribute.name, attribute.value])),
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        visible: rect.width > 0 && rect.height > 0 && computed.visibility !== "hidden" && computed.display !== "none",
        styles,
      };
    }, options.includeStyles ?? true);
    const warnings: string[] = [];
    let accessibility: string | undefined;
    if (options.includeAccessibility ?? true) {
      try {
        accessibility = await selected.ariaSnapshot();
      } catch (error) {
        warnings.push(`Accessibility snapshot failed: ${messageOf(error)}`);
      }
    }
    let listeners: unknown[] | undefined;
    if (options.includeListeners ?? true) {
      const cdp = await this.session.cdpSession(options.targetId);
      try {
        const evaluated = (await cdp.send("Runtime.evaluate", {
          expression: `document.querySelectorAll(${JSON.stringify(options.selector)})[${index}]`,
          returnByValue: false,
        })) as { result?: { objectId?: string } };
        if (evaluated.result?.objectId) {
          const response = await cdp.send("DOMDebugger.getEventListeners", {
            objectId: evaluated.result.objectId,
          });
          listeners = (response.listeners ?? []).map((listener) => ({
            type: listener.type,
            useCapture: listener.useCapture,
            passive: listener.passive,
            once: listener.once,
            scriptId: listener.scriptId,
            lineNumber: listener.lineNumber,
            columnNumber: listener.columnNumber,
          }));
        }
      } catch (error) {
        warnings.push(`Event listener inspection failed: ${messageOf(error)}`);
      } finally {
        await cdp.detach();
      }
    }
    return { selector: options.selector, index, element, accessibility, listeners, warnings };
  }

  async executeJavascript(options: {
    targetId?: string;
    expression: string;
    awaitPromise?: boolean;
    timeoutMs?: number;
  }) {
    const cdp = await this.session.cdpSession(options.targetId);
    try {
      const response = (await withTimeout(
        cdp.send("Runtime.evaluate", {
          expression: options.expression,
          awaitPromise: options.awaitPromise ?? true,
          returnByValue: true,
          userGesture: true,
        }),
        options.timeoutMs ?? 10_000,
      )) as {
        result: { type: string; value?: unknown; unserializableValue?: string; description?: string };
        exceptionDetails?: { text?: string; exception?: { description?: string } };
      };
      if (response.exceptionDetails) {
        throw new TyporaToolError(
          "JAVASCRIPT_ERROR",
          response.exceptionDetails.exception?.description ?? response.exceptionDetails.text ?? "JavaScript evaluation failed",
        );
      }
      return {
        type: response.result.type,
        value: response.result.value ?? response.result.unserializableValue ?? response.result.description ?? null,
      };
    } finally {
      await cdp.detach();
    }
  }

  async sendCdpCommand(options: { targetId?: string; method: string; params?: Record<string, unknown> }) {
    const cdp = await this.session.cdpSession(options.targetId);
    try {
      return await cdp.send(options.method as never, options.params as never);
    } finally {
      await cdp.detach();
    }
  }

  getConsoleLogs(options: Parameters<TyporaSession["observer"]["console"]>[0] = {}) {
    return this.session.observer.console(options);
  }

  getJavascriptErrors(options: Parameters<TyporaSession["observer"]["errors"]>[0] = {}) {
    return this.session.observer.errors(options);
  }

  async getNetworkRequests(options: Parameters<TyporaSession["observer"]["network"]>[0] = {}) {
    return await this.session.observer.network(options);
  }

  clearDebugEvents(targetId?: string) {
    this.session.observer.clear(targetId);
    return { cleared: true, latestSeq: this.session.observer.latestSeq() };
  }

  async click(options: { targetId?: string; selector: string; index?: number }) {
    const locator = await this.#element(options);
    await locator.click();
    return { clicked: true };
  }

  async type(options: { targetId?: string; selector: string; index?: number; text: string; clear?: boolean }) {
    const locator = await this.#element(options);
    if (options.clear ?? true) await locator.fill(options.text);
    else await locator.pressSequentially(options.text);
    return { typed: true, characters: options.text.length };
  }

  async pressKey(options: { targetId?: string; selector?: string; index?: number; key: string }) {
    const page = await this.session.page(options.targetId);
    if (options.selector) await (await this.#element({ ...options, selector: options.selector })).press(options.key);
    else await page.keyboard.press(options.key);
    return { pressed: options.key };
  }

  async scroll(options: { targetId?: string; selector?: string; deltaX?: number; deltaY: number }) {
    const page = await this.session.page(options.targetId);
    if (options.selector) {
      const locator = await this.#element({ ...options, selector: options.selector });
      await locator.evaluate((element, delta) => element.scrollBy(delta.x, delta.y), {
        x: options.deltaX ?? 0,
        y: options.deltaY,
      });
    } else {
      await page.mouse.wheel(options.deltaX ?? 0, options.deltaY);
    }
    return { scrolled: true };
  }

  async takeScreenshot(options: { targetId?: string; selector?: string; fullPage?: boolean }) {
    const page = await this.session.page(options.targetId);
    return options.selector
      ? await (await this.#element({ ...options, selector: options.selector })).screenshot({ type: "png" })
      : await page.screenshot({ type: "png", fullPage: options.fullPage ?? false });
  }

  async #element(options: { targetId?: string; selector: string; index?: number }): Promise<Locator> {
    const page = await this.session.page(options.targetId);
    const locator = page.locator(options.selector);
    return locator.nth(selectElementIndex(await locator.count(), options.index));
  }
}

function messageOf(error: unknown): string {
  if (error instanceof TyporaSessionError || error instanceof Error) return error.message;
  return String(error);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new TyporaToolError("JAVASCRIPT_TIMEOUT", "JavaScript evaluation timed out")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForNoTyporaProcesses(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await listTyporaProcesses()).length === 0) return true;
    await delay(200);
  }
  return false;
}
