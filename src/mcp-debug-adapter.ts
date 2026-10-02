import { RemoteControlTools } from "./remote-control.js";
import { StandaloneTyporaTools } from "./standalone-tools.js";
import { TyporaTools } from "./tools.js";

export class AutoTyporaTools {
  readonly standalone = new StandaloneTyporaTools();
  readonly remote = new RemoteControlTools();
  readonly cdp = new TyporaTools();
  #selected: "standalone" | "remote" | "cdp" | null = null;

  async #backend() {
    const forced = process.env.TYPORA_BACKEND;
    if (forced === "cdp") return this.cdp;
    if (forced === "remote-control") return this.remote;
    if (forced === "standalone") return this.standalone;
    if (this.#selected === "standalone" && await this.standalone.available()) return this.standalone;
    if (this.#selected === "remote" && await this.remote.available()) return this.remote;
    if (this.#selected === "cdp") return this.cdp;
    if (await this.standalone.available()) {
      this.#selected = "standalone";
      return this.standalone;
    }
    if (await this.remote.available()) {
      this.#selected = "remote";
      return this.remote;
    }
    this.#selected = "cdp";
    return this.cdp;
  }

  async status() { return (await this.#backend()).status(); }
  async capabilities(targetId?: string) {
    const backend: any = await this.#backend();
    if (typeof backend.capabilities === "function") return await backend.capabilities(targetId);
    return {
      backend: process.env.TYPORA_BACKEND === "cdp" ? "cdp" : "remote-control",
      snapshot: false,
      sourceRead: false,
      resourceTiming: false,
      debugNetworkCapture: false,
      screenshot: typeof backend.takeScreenshot === "function",
      debugEval: typeof backend.executeJavascript === "function",
      cdp: typeof backend.sendCdpCommand === "function",
      safeRestart: typeof backend.restart === "function",
    };
  }
  async launch(options: any = {}) { return (await this.#backend()).launch(options); }
  async close(force = false) { return (await this.#backend()).close(force); }
  async restart() {
    const backend: any = await this.#backend();
    if (typeof backend.restart !== "function") throw new Error("TYPORA_RESTART_UNAVAILABLE");
    return await backend.restart();
  }
  async reload(targetId?: string, ignoreCache = false) { return (await this.#backend()).reload(targetId, ignoreCache); }
  async snapshot(options: any = {}) {
    const backend: any = await this.#backend();
    if (typeof backend.snapshot !== "function") throw new Error("SNAPSHOT_UNAVAILABLE");
    return await backend.snapshot(options);
  }
  async getDocumentSource(options: any = {}) {
    const backend: any = await this.#backend();
    if (typeof backend.getDocumentSource !== "function") throw new Error("DOCUMENT_SOURCE_UNAVAILABLE");
    return await backend.getDocumentSource(options);
  }
  async openDocument(options: any) {
    const backend: any = await this.#backend();
    if (typeof backend.openDocument !== "function") throw new Error("OPEN_DOCUMENT_UNAVAILABLE");
    return await backend.openDocument(options);
  }
  async getDom(options: any) { return (await this.#backend()).getDom(options); }
  async querySelector(options: any) { return (await this.#backend()).querySelector(options); }
  async getElement(options: any) { return (await this.#backend()).getElement(options); }
  async executeJavascript(options: any) { return (await this.#backend()).executeJavascript(options); }
  async sendCdpCommand(options: any) { return (await this.#backend()).sendCdpCommand(options); }
  async getConsoleLogs(options: any) { return (await this.#backend()).getConsoleLogs(options); }
  async getJavascriptErrors(options: any) { return (await this.#backend()).getJavascriptErrors(options); }
  async getNetworkRequests(options: any) { return (await this.#backend()).getNetworkRequests(options); }
  async clearDebugEvents(targetId?: string) { return (await this.#backend()).clearDebugEvents(targetId); }
  async enableDebugNetworkCapture(targetId?: string) {
    const backend: any = await this.#backend();
    if (typeof backend.enableDebugNetworkCapture !== "function") throw new Error("DEBUG_NETWORK_CAPTURE_UNAVAILABLE");
    return await backend.enableDebugNetworkCapture(targetId);
  }
  async disableDebugNetworkCapture(targetId?: string) {
    const backend: any = await this.#backend();
    if (typeof backend.disableDebugNetworkCapture !== "function") throw new Error("DEBUG_NETWORK_CAPTURE_UNAVAILABLE");
    return await backend.disableDebugNetworkCapture(targetId);
  }
  async runFixture(options: any) {
    const backend: any = await this.#backend();
    if (typeof backend.runFixture !== "function") throw new Error("FIXTURE_UNAVAILABLE");
    return await backend.runFixture(options);
  }
  async click(options: any) { return (await this.#backend()).click(options); }
  async type(options: any) { return (await this.#backend()).type(options); }
  async pressKey(options: any) { return (await this.#backend()).pressKey(options); }
  async scroll(options: any) { return (await this.#backend()).scroll(options); }
  async takeScreenshot(options?: any) { return (await this.#backend()).takeScreenshot(options); }
}
