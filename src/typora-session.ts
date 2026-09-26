import { chromium, type Browser, type BrowserContext, type CDPSession, type Page } from "playwright-core";
import { DebugObserver } from "./debug-observer.js";

export interface TyporaTarget {
  targetId: string;
  title: string;
  url: string;
  focused: boolean;
}

export class TyporaSessionError extends Error {
  constructor(
    readonly code: "CDP_UNREACHABLE" | "RENDERER_NOT_FOUND" | "TARGET_AMBIGUOUS",
    message: string,
  ) {
    super(message);
    this.name = "TyporaSessionError";
  }
}

export function selectTarget(targets: TyporaTarget[], requestedTargetId?: string): TyporaTarget {
  if (requestedTargetId) {
    const requested = targets.find((target) => target.targetId === requestedTargetId);
    if (!requested) throw new TyporaSessionError("RENDERER_NOT_FOUND", `Renderer ${requestedTargetId} was not found`);
    return requested;
  }
  const focused = targets.filter((target) => target.focused);
  if (focused.length === 1) return focused[0]!;
  if (targets.length === 0) throw new TyporaSessionError("RENDERER_NOT_FOUND", "No Typora renderer was found");
  throw new TyporaSessionError("TARGET_AMBIGUOUS", "Pass targetId because no single focused renderer was found");
}

export class TyporaSession {
  readonly observer: DebugObserver;
  #browser: Browser | null = null;
  #context: BrowserContext | null = null;
  #endpoint: string | null = null;
  #nextTargetId = 1;
  #ids = new WeakMap<Page, string>();
  #pages = new Map<string, Page>();

  constructor(observer = new DebugObserver()) {
    this.observer = observer;
  }

  get connected(): boolean {
    return Boolean(this.#browser?.isConnected());
  }

  get endpoint(): string | null {
    return this.#endpoint;
  }

  async connect(endpoint: string, timeoutMs = 10_000): Promise<TyporaTarget[]> {
    try {
      const browser = await chromium.connectOverCDP(endpoint, { timeout: timeoutMs });
      const context = browser.contexts()[0];
      if (!context) throw new TyporaSessionError("RENDERER_NOT_FOUND", "CDP has no browser context");
      this.#browser = browser;
      this.#context = context;
      this.#endpoint = endpoint;
      for (const page of context.pages()) this.#registerPage(page);
      context.on("page", (page) => this.#registerPage(page));
      browser.on("disconnected", () => {
        this.#browser = null;
        this.#context = null;
        this.#pages.clear();
      });
      return await this.targets();
    } catch (error) {
      if (error instanceof TyporaSessionError) throw error;
      throw new TyporaSessionError(
        "CDP_UNREACHABLE",
        `Could not connect to ${endpoint}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async targets(): Promise<TyporaTarget[]> {
    const targets = await Promise.all(
      [...this.#pages].map(async ([targetId, page]) => {
        try {
          return {
            targetId,
            title: await page.title(),
            url: page.url(),
            focused: await page.evaluate(() => document.hasFocus()),
          };
        } catch {
          return null;
        }
      }),
    );
    return targets.filter((target): target is TyporaTarget => target !== null);
  }

  async page(targetId?: string): Promise<Page> {
    const target = selectTarget(await this.targets(), targetId);
    const page = this.#pages.get(target.targetId);
    if (!page) throw new TyporaSessionError("RENDERER_NOT_FOUND", `Renderer ${target.targetId} was closed`);
    return page;
  }

  async cdpSession(targetId?: string): Promise<CDPSession> {
    if (!this.#context) throw new TyporaSessionError("CDP_UNREACHABLE", "Typora is not connected");
    return await this.#context.newCDPSession(await this.page(targetId));
  }

  async reload(targetId?: string, ignoreCache = false): Promise<void> {
    const page = await this.page(targetId);
    if (ignoreCache) {
      const cdp = await this.#context!.newCDPSession(page);
      await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
      await page.reload({ waitUntil: "domcontentloaded" });
      await cdp.detach();
      return;
    }
    await page.reload({ waitUntil: "domcontentloaded" });
  }

  async currentFile(targetId?: string): Promise<{ path: string; source: string; confidence: "medium" } | null> {
    const page = await this.page(targetId);
    const found = await page.evaluate(() => {
      const runtime = window as typeof window & {
        File?: { filePath?: unknown; getCurrentFilePath?: () => unknown };
        __typora_file_path__?: unknown;
      };
      let getterValue: unknown;
      try {
        getterValue = runtime.File?.getCurrentFilePath?.call(runtime.File);
      } catch {
        getterValue = undefined;
      }
      const candidates: Array<[string, unknown]> = [
        ["renderer:File.filePath", runtime.File?.filePath],
        ["renderer:File.getCurrentFilePath", getterValue],
        ["renderer:__typora_file_path__", runtime.__typora_file_path__],
        ["dom:data-file-path", document.body?.dataset.filePath],
      ];
      return candidates.find(([, value]) => typeof value === "string" && value.length > 0) ?? null;
    });
    return found ? { path: String(found[1]), source: String(found[0]), confidence: "medium" } : null;
  }

  async closeApplication(targetId?: string): Promise<void> {
    if (!this.#context) throw new TyporaSessionError("CDP_UNREACHABLE", "Typora is not connected");
    const page = targetId ? await this.page(targetId) : [...this.#pages.values()][0];
    if (!page) throw new TyporaSessionError("RENDERER_NOT_FOUND", "No Typora renderer was found");
    const cdp = await this.#context.newCDPSession(page);
    await cdp.send("Browser.close");
  }

  #registerPage(page: Page): string {
    const existing = this.#ids.get(page);
    if (existing) return existing;
    const targetId = `target-${this.#nextTargetId++}`;
    this.#ids.set(page, targetId);
    this.#pages.set(targetId, page);
    this.observer.attach(page, targetId);
    page.once("close", () => this.#pages.delete(targetId));
    return targetId;
  }
}
