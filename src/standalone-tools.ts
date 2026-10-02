import { closeTyporaProcess, listTyporaProcesses, TyporaProcessManager, type LaunchOptions } from "./typora-process.js";
import { StandaloneBridgeClient } from "./standalone-client.js";
import { TyporaToolError } from "./tools.js";
import { createEvidenceDirectory, readFixture, writeEvidence } from "./fixture.js";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function selectActiveTarget<T extends { targetId: string; focused?: boolean }>(targets: T[]): T | null {
  const focused = targets.filter((target) => target.focused);
  if (focused.length === 1) return focused[0]!;
  return targets.length === 1 ? targets[0]! : null;
}

export class StandaloneTyporaTools {
  readonly process: TyporaProcessManager;
  readonly client: StandaloneBridgeClient;
  #lastLaunchOptions: LaunchOptions | null = null;
  #fixtureProfile: string | null = null;

  constructor(processManager = new TyporaProcessManager(), client = new StandaloneBridgeClient()) {
    this.process = processManager;
    this.client = client;
  }

  async available() {
    return await this.client.available();
  }

  async status() {
    const processStatus = this.process.status();
    let processes: Awaited<ReturnType<typeof listTyporaProcesses>> = [];
    try {
      processes = await listTyporaProcesses();
    } catch {
      // Process inspection is supplementary to the registry-backed bridge state.
    }
    const registryTargets = await this.client.targets();
    const targets = await Promise.all(registryTargets.map(async (target) => {
      try {
        return await this.client.call("status", {}, target.targetId);
      } catch {
        return { targetId: target.targetId, unavailable: true };
      }
    }));
    const connectedTargets = targets.filter((target) => !target.unavailable);
    const activeTarget = selectActiveTarget(connectedTargets);
    return {
      running: processStatus.running || processes.length > 0,
      owned: processStatus.owned,
      pid: processStatus.pid ?? processes[0]?.pid ?? null,
      processes,
      executablePath: processStatus.executablePath,
      rendererConnected: connectedTargets.length > 0,
      bridge: "standalone",
      registryDir: this.client.registryDir,
      targets,
      activeTargetId: activeTarget?.targetId ?? null,
      latestDebugSeq: activeTarget?.latestDebugSeq ?? null,
    };
  }

  async capabilities(targetId?: string) {
    const bridge = await this.client.call("capabilities", {}, targetId);
    return {
      ...bridge,
      safeRestart: this.process.status().running,
      backend: "standalone",
    };
  }

  async launch(options: LaunchOptions & { restartIfNeeded?: boolean } = {}) {
    const before = await this.status();
    if (before.rendererConnected && !options.userDataDir) return before;
    if (before.running && !options.restartIfNeeded && !options.userDataDir) {
      throw new TyporaToolError(
        "TYPORA_BRIDGE_NOT_CONNECTED",
        "Typora is already running but no standalone bridge is connected; install the bridge and restart Typora, or pass restartIfNeeded",
      );
    }
    if (before.running && !options.userDataDir) await this.close(false);
    this.#lastLaunchOptions = { ...options, debugging: false };
    await this.process.launch(this.#lastLaunchOptions);
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const status = await this.status();
      if (status.rendererConnected && (!options.filePath || status.targets.some((target: any) => target.filePath === options.filePath))) {
        return status;
      }
      await delay(200);
    }
    throw new TyporaToolError("TYPORA_BRIDGE_UNAVAILABLE", "Typora started but did not register a standalone bridge target");
  }

  async close(force = false) {
    if (!this.process.status().running) {
      throw new TyporaToolError("TYPORA_OWNERSHIP_REQUIRED", "Typora was not launched by this MCP server and will not be closed automatically");
    }
    await this.process.close(force);
    if (this.#fixtureProfile) {
      const profile = this.#fixtureProfile;
      this.#fixtureProfile = null;
      for (let attempt = 0; attempt < 10; attempt += 1) {
        try {
          await rm(profile, { recursive: true, force: true });
          break;
        } catch {
          await delay(200);
        }
      }
    }
    return await this.status();
  }

  async reload(targetId?: string) {
    void targetId;
    throw new TyporaToolError("TYPORA_RELOAD_UNAVAILABLE", "Standalone bridge does not use location.reload because Typora may exit; use typora_restart for an MCP-managed instance");
  }

  async restart() {
    if (!this.process.status().running || !this.#lastLaunchOptions) {
      throw new TyporaToolError("TYPORA_RESTART_REQUIRES_MANAGED_INSTANCE", "Standalone restart is available only for a Typora instance launched by this MCP server");
    }
    await this.process.close(false);
    for (let attempt = 0; attempt < 25 && this.process.status().running; attempt += 1) await delay(200);
    if (this.process.status().running) {
      throw new TyporaToolError("TYPORA_CLOSE_PENDING", "Typora did not close; it may be waiting for an unsaved-document decision");
    }
    return await this.launch(this.#lastLaunchOptions);
  }

  async snapshot(options: any = {}) { return await this.client.call("snapshot", options, options.targetId); }
  async getDocumentSource(options: any = {}) { return await this.client.call("getDocumentSource", options, options.targetId); }
  async openDocument(options: any) { return await this.client.call("openDocument", options, options.targetId); }
  async getDom(options: any) { return await this.client.call("getDom", options, options.targetId); }
  async querySelector(options: any) { return await this.client.call("querySelector", options, options.targetId); }
  async getElement(options: any) { return await this.client.call("getElement", options, options.targetId); }
  async click(options: any) { return await this.client.call("click", options, options.targetId); }
  async type(options: any) { return await this.client.call("type", options, options.targetId); }
  async pressKey(options: any) { return await this.client.call("pressKey", options, options.targetId); }
  async scroll(options: any) { return await this.client.call("scroll", options, options.targetId); }
  async clearDebugEvents(targetId?: string) { return await this.client.call("clearDebugEvents", {}, targetId); }
  async enableDebugNetworkCapture(targetId?: string) {
    return await this.client.call("enableDebugNetworkCapture", {}, targetId);
  }
  async disableDebugNetworkCapture(targetId?: string) {
    return await this.client.call("disableDebugNetworkCapture", {}, targetId);
  }

  async runFixture(options: { fixturePath: string; targetId?: string; allowSharedTarget?: boolean }) {
    const fixtureRoot = process.env.TYPORA_MCP_FIXTURE_ROOT ?? process.cwd();
    const evidenceRoot = process.env.TYPORA_MCP_EVIDENCE_ROOT ?? process.cwd() + "/evidence";
    const { fixture, documentPath } = await readFixture(options.fixturePath, fixtureRoot);
    let targetId = options.targetId;
    if (options.allowSharedTarget) {
      if (!targetId) throw new TyporaToolError("TARGET_ID_REQUIRED", "Shared fixture runs require targetId");
    } else {
      const before = await this.status();
      if (before.owned) await this.close(false);
      this.#fixtureProfile = await mkdtemp(join(tmpdir(), "typora-mcp-fixture-"));
      await this.launch({ filePath: documentPath, userDataDir: this.#fixtureProfile, extraArgs: ["--new-window"] });
      targetId = (await this.status()).targets.find((target: any) => target.filePath === documentPath)?.targetId;
      if (!targetId) throw new TyporaToolError("TYPORA_BRIDGE_TARGET_AMBIGUOUS", "Fixture target is ambiguous");
    }
    const evidence = await createEvidenceDirectory(evidenceRoot);
    const sourceBefore = await this.getDocumentSource({ targetId, maxChars: 1 });
    if (sourceBefore.path !== documentPath) {
      throw new TyporaToolError("FIXTURE_DOCUMENT_MISMATCH", "Typora did not open the fixture document");
    }
    const fixtureStartSeq = (await this.status()).latestDebugSeq ?? 0;
    const waitFor = async (wait: NonNullable<typeof fixture.waits>[number]) => {
      const deadline = Date.now() + (wait.timeoutMs ?? 5_000);
      let matched = false;
      while (Date.now() < deadline) {
        let ready = false;
        if (wait.type === "selector") {
          ready = (await this.querySelector({ targetId, selector: wait.value, limit: 1 })).length > 0;
        } else if (wait.type === "text") {
          ready = (await this.getDom({ targetId, selector: "#write", format: "text", maxChars: 500_000 })).content.includes(wait.value);
        } else if ("eventType" in wait) {
          ready = (await this.client.call("debugEvents", { type: wait.eventType, afterSeq: wait.afterSeq ?? fixtureStartSeq, limit: 1 }, targetId)).events.length > 0;
        }
        if (ready) {
          matched = true;
          break;
        }
        await delay(50);
      }
      if (!matched) throw new TyporaToolError("FIXTURE_WAIT_TIMEOUT", "Fixture wait did not complete: " + (wait.type === "event" ? wait.eventType : wait.value));
    };
    for (const wait of (fixture.waits ?? []).filter((wait) => wait.type !== "event")) await waitFor(wait);
    const beforeSeq = fixtureStartSeq;
    let networkCaptureEnabled = false;
    for (const action of fixture.actions ?? []) {
      if (action.type === "click") await this.click({ targetId, selector: action.selector });
      if (action.type === "pressKey") await this.pressKey({ targetId, selector: action.selector, key: action.key });
      if (action.type === "scroll") await this.scroll({ targetId, selector: action.selector, deltaX: action.deltaX, deltaY: action.deltaY });
      if (action.type === "type") await this.type({ targetId, selector: action.selector, text: action.text, clear: action.clear });
      if (action.type === "networkProbe") {
        await this.enableDebugNetworkCapture(targetId);
        networkCaptureEnabled = true;
        await this.client.call("networkProbe", {}, targetId);
      }
    }
    for (const wait of (fixture.waits ?? []).filter((wait) => wait.type === "event")) await waitFor(wait);
    const snapshot = await this.snapshot({ targetId });
    const assertions: Array<{ type: string; passed: boolean; message?: string }> = [];
    for (const assertion of fixture.assertions ?? [{ type: "sourceUnchanged" }]) {
      if (assertion.type === "selectorExists") {
        const result = await this.querySelector({ targetId, selector: assertion.selector, limit: 1 });
        assertions.push({ type: assertion.type, passed: result.length > 0, message: assertion.selector });
      }
      if (assertion.type === "styleEquals") {
        const element = await this.getElement({ targetId, selector: assertion.selector, includeStyles: true });
        assertions.push({ type: assertion.type, passed: element.styles?.[assertion.property] === assertion.value, message: assertion.selector + " " + assertion.property });
      }
      if (assertion.type === "event") {
        const events = await this.client.call("debugEvents", { type: assertion.eventType, afterSeq: assertion.afterSeq ?? beforeSeq }, targetId);
        assertions.push({ type: assertion.type, passed: events.events.length > 0, message: assertion.eventType });
      }
    }
    const sourceAfter = await this.getDocumentSource({ targetId, maxChars: 1 });
    const sourcePassed = sourceBefore.sourceHash === sourceAfter.sourceHash;
    assertions.push({ type: "sourceUnchanged", passed: sourcePassed });
    const capabilities = await this.capabilities(targetId);
    let screenshot = "not-requested";
    if (fixture.evidence?.screenshot) {
      if (capabilities.screenshot) {
        await writeFile(join(evidence.directory, "screenshot.png"), await this.takeScreenshot());
        screenshot = "captured";
      } else {
        screenshot = "unsupported";
      }
    }
    const events = await this.client.call("debugEvents", { afterSeq: beforeSeq, limit: 1_000 }, targetId);
    if (networkCaptureEnabled) await this.disableDebugNetworkCapture(targetId);
    await writeEvidence(evidence.directory, "source.json", { before: sourceBefore, after: sourceAfter });
    await writeEvidence(evidence.directory, "snapshot.json", snapshot);
    await writeEvidence(evidence.directory, "events.json", events);
    await writeEvidence(evidence.directory, "assertions.json", assertions);
    await writeEvidence(evidence.directory, "run.json", { fixture, documentPath, targetId, sourceBefore, sourceAfter, snapshot, assertions, capabilities, screenshot });
    return { runId: evidence.runId, evidenceDirectory: evidence.directory, passed: assertions.every((item) => item.passed), assertions };
  }

  async getConsoleLogs(options: any = {}) {
    return await this.client.call("debugEvents", { ...options, type: "console" }, options.targetId);
  }

  async getJavascriptErrors(options: any = {}) {
    return await this.client.call("debugEvents", { ...options, type: "javascript-error" }, options.targetId);
  }

  async getNetworkRequests(options: any = {}) {
    return await this.client.call("debugEvents", { ...options, type: "network" }, options.targetId);
  }

  async executeJavascript() {
    throw new TyporaToolError("DEBUG_EVAL_DISABLED", "Standalone bridge does not expose arbitrary JavaScript evaluation");
  }

  async sendCdpCommand() {
    throw new TyporaToolError("CDP_UNAVAILABLE", "Standalone bridge does not expose Chrome DevTools Protocol");
  }

  async takeScreenshot(): Promise<Buffer> {
    throw new TyporaToolError("SCREENSHOT_UNAVAILABLE", "Standalone bridge has no screenshot backend");
  }
}
