import { readFile } from "node:fs/promises";
import { TyporaProcessManager, type LaunchOptions } from "./typora-process.js";
import { TyporaTools } from "./tools.js";

export class RemoteControlError extends Error {
  constructor(readonly code: string, message: string, readonly data?: unknown) {
    super(message);
    this.name = "RemoteControlError";
  }
}

export class RemoteControlClient {
  readonly endpoint: string;
  readonly token: string;
  readonly timeoutMs: number;
  #nextId = 1;

  constructor(options: { endpoint?: string; token?: string; timeoutMs?: number } = {}) {
    this.endpoint = options.endpoint ?? process.env.TYPORA_RPC_URL ?? "http://127.0.0.1:5080/";
    this.token = options.token ?? process.env.TYPORA_RPC_TOKEN ?? "secret-token";
    this.timeoutMs = options.timeoutMs ?? 5_000;
  }

  async request<T = unknown>(method: string, params?: unknown): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const body: Record<string, unknown> = { jsonrpc: "2.0", id: this.#nextId++, method };
      if (params !== undefined) body.params = params;
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.token}` },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const payload = (await response.json()) as { result?: T; error?: { code?: number; message?: string; data?: unknown } };
      if (!response.ok || payload.error) {
        throw new RemoteControlError(
          String(payload.error?.data && typeof payload.error.data === "object" && "typoraCode" in payload.error.data ? payload.error.data.typoraCode : payload.error?.code ?? response.status),
          payload.error?.message ?? `${response.status} ${response.statusText}`,
          payload.error?.data,
        );
      }
      return payload.result as T;
    } catch (error) {
      if (error instanceof RemoteControlError) throw error;
      throw new RemoteControlError("RPC_UNAVAILABLE", error instanceof Error ? error.message : String(error));
    } finally {
      clearTimeout(timeout);
    }
  }
}

export class RemoteControlTools {
  readonly process: TyporaProcessManager;
  readonly client: RemoteControlClient;
  #observerInstalled = false;

  constructor(processManager = new TyporaProcessManager(), client = new RemoteControlClient()) {
    this.process = processManager;
    this.client = client;
  }

  async available(): Promise<boolean> {
    try {
      await this.client.request("system.ping");
      return true;
    } catch {
      return false;
    }
  }

  async status() {
    const processStatus = this.process.status();
    try {
      const [remote, version, plugins] = await Promise.all([
        this.client.request<Record<string, unknown>>("system.getStatus"),
        this.client.request<Record<string, unknown>>("system.getVersion"),
        this.client.request<Array<Record<string, unknown>>>("plugin.list"),
      ]);
      return {
        running: true,
        owned: processStatus.owned,
        pid: processStatus.pid,
        bridgeConnected: true,
        backend: "remote-control",
        cdpEndpoint: null,
        currentFile: remote.filePath ? { path: remote.filePath, source: "remote-control", confidence: "high" } : null,
        targets: [{ targetId: "remote-control", title: "Typora", url: "typora://renderer", focused: true }],
        activeTargetId: "remote-control",
        typora: version,
        plugins,
        latestDebugSeq: this.#observerInstalled ? await this.getLatestDebugSeq() : 0,
        warnings: [],
      };
    } catch (error) {
      return {
        running: processStatus.running,
        owned: processStatus.owned,
        pid: processStatus.pid,
        bridgeConnected: false,
        backend: "remote-control",
        cdpEndpoint: null,
        currentFile: null,
        targets: [],
        activeTargetId: null,
        latestDebugSeq: 0,
        warnings: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  async launch(options: LaunchOptions = {}) {
    const existing = await this.available();
    if (!existing) await this.process.launch({ ...options, debugging: false });
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      if (await this.available()) return await this.status();
      await delay(200);
    }
    throw new RemoteControlError("REMOTE_CONTROL_UNAVAILABLE", "Typora remote_control did not become available");
  }

  async close(force = false) {
    if (!force && await this.available()) {
      try { await this.client.request("system.exitTypora"); } catch { /* process is expected to disappear */ }
    } else {
      await this.process.close(force);
    }
    return await this.status();
  }

  async reload() {
    await this.eval("location.reload(); true");
    return { reloaded: true };
  }

  async getDom(options: { selector?: string; format?: "html" | "text" | "accessibility"; maxChars?: number }) {
    const selector = options.selector ?? "html";
    const expression = `(function(){const e=document.querySelector(${json(selector)});if(!e)throw new Error("SELECTOR_NOT_FOUND");return ${options.format === "text" ? "e.innerText" : options.format === "accessibility" ? "e.innerText" : "e.outerHTML"}})()`;
    const value = String(await this.eval(expression));
    return { selector, format: options.format ?? "html", ...truncate(value, options.maxChars ?? 50_000) };
  }

  async querySelector(options: { selector: string; limit?: number }) {
    const limit = options.limit ?? 50;
    return await this.eval(`Array.from(document.querySelectorAll(${json(options.selector)})).slice(0,${limit}).map((e,index)=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return{index,tag:e.tagName.toLowerCase(),text:(e.textContent||"").trim().slice(0,500),attributes:Object.fromEntries(Array.from(e.attributes).map(a=>[a.name,a.value])),visible:r.width>0&&r.height>0&&s.display!=="none"&&s.visibility!=="hidden",rect:{x:r.x,y:r.y,width:r.width,height:r.height}}})`);
  }

  async getElement(options: { selector: string; index?: number; includeStyles?: boolean; includeListeners?: boolean; includeAccessibility?: boolean }) {
    const index = options.index ?? 0;
    const styles = options.includeStyles === false ? "undefined" : "Object.fromEntries(Array.from(s).map(k=>[k,s.getPropertyValue(k)]))";
    const accessibility = options.includeAccessibility === false ? "undefined" : "(e.innerText||'').slice(0,5000)";
    const listeners = options.includeListeners === false ? "undefined" : "window.__typoraMcpDebug&&window.__typoraMcpDebug.getListeners?window.__typoraMcpDebug.getListeners(e):[]";
    const expression = `(function(){const a=document.querySelectorAll(${json(options.selector)}),e=a[${index}];if(!e)throw new Error(a.length?"SELECTOR_AMBIGUOUS":"SELECTOR_NOT_FOUND");const r=e.getBoundingClientRect(),s=getComputedStyle(e);return{selector:${json(options.selector)},index:${index},element:{tag:e.tagName.toLowerCase(),text:(e.textContent||"").trim().slice(0,2000),html:e.outerHTML.slice(0,20000),attributes:Object.fromEntries(Array.from(e.attributes).map(a=>[a.name,a.value])),rect:{x:r.x,y:r.y,width:r.width,height:r.height},visible:r.width>0&&r.height>0&&s.display!=="none"&&s.visibility!=="hidden",styles:${styles}},accessibility:${accessibility},listeners:${listeners}}})()`;
    return await this.eval(expression);
  }

  async executeJavascript(options: { expression: string; awaitPromise?: boolean; timeoutMs?: number }) {
    return await this.eval(options.expression);
  }

  async sendCdpCommand() {
    throw new RemoteControlError("CDP_UNAVAILABLE", "The remote-control backend does not expose CDP commands");
  }

  async getConsoleLogs(options: { afterSeq?: number; levels?: string[]; limit?: number } = {}) {
    await this.#installObserver();
    return await this.eval(`window.__typoraMcpDebug.read("console",${options.afterSeq ?? 0},${options.limit ?? 100},${json(options.levels ?? [])})`);
  }

  async getJavascriptErrors(options: { afterSeq?: number; limit?: number } = {}) {
    await this.#installObserver();
    return await this.eval(`window.__typoraMcpDebug.read("error",${options.afterSeq ?? 0},${options.limit ?? 100},[])`);
  }

  async getNetworkRequests(options: { afterSeq?: number; urlPattern?: string; limit?: number; includeBodies?: boolean; maxBodyChars?: number } = {}) {
    await this.#installObserver();
    return await this.eval(`window.__typoraMcpDebug.read("network",${options.afterSeq ?? 0},${options.limit ?? 100},[],${json(options.urlPattern ?? "")})`);
  }

  async clearDebugEvents() {
    await this.#installObserver();
    return await this.eval("window.__typoraMcpDebug.clear(); true");
  }

  async click(options: { selector: string; index?: number }) {
    return await this.eval(`(function(){const a=document.querySelectorAll(${json(options.selector)}),e=a[${options.index ?? 0}];if(!e)throw new Error(a.length?"SELECTOR_AMBIGUOUS":"SELECTOR_NOT_FOUND");e.click();return{clicked:true}})()`);
  }

  async type(options: { selector: string; index?: number; text: string; clear?: boolean }) {
    return await this.eval(`(function(){const a=document.querySelectorAll(${json(options.selector)}),e=a[${options.index ?? 0}];if(!e)throw new Error(a.length?"SELECTOR_AMBIGUOUS":"SELECTOR_NOT_FOUND");e.focus();if("value" in e){${options.clear === false ? "" : "e.value=\"\";"}e.value+=${json(options.text)};e.dispatchEvent(new Event("input",{bubbles:true}));e.dispatchEvent(new Event("change",{bubbles:true}))}else{document.execCommand("insertText",false,${json(options.text)})}return{typed:true,characters:${options.text.length}}})()`);
  }

  async pressKey(options: { key: string; selector?: string; index?: number }) {
    const target = options.selector ? `(document.querySelectorAll(${json(options.selector)})[${options.index ?? 0}])` : "document.activeElement";
    return await this.eval(`(function(){const e=${target};if(!e)throw new Error("SELECTOR_NOT_FOUND");e.dispatchEvent(new KeyboardEvent("keydown",{key:${json(options.key)},bubbles:true}));e.dispatchEvent(new KeyboardEvent("keyup",{key:${json(options.key)},bubbles:true}));return{pressed:${json(options.key)}}})()`);
  }

  async scroll(options: { selector?: string; deltaX?: number; deltaY: number }) {
    const target = options.selector ? `document.querySelector(${json(options.selector)})` : "document.scrollingElement";
    return await this.eval(`(function(){const e=${target};if(!e)throw new Error("SELECTOR_NOT_FOUND");e.scrollBy(${options.deltaX ?? 0},${options.deltaY});return{scrolled:true}})()`);
  }

  async takeScreenshot() {
    const result = await this.eval("JSBridge.invoke('page.screenshot')");
    if (typeof result !== "string") throw new RemoteControlError("SCREENSHOT_UNAVAILABLE", "Typora did not return a screenshot path");
    return await readFile(result);
  }

  async eval(expression: string) {
    return await this.client.request("system.eval", [expression]);
  }

  async #installObserver() {
    if (this.#observerInstalled) return;
    await this.eval(DEBUG_OBSERVER_SCRIPT);
    this.#observerInstalled = true;
  }

  async getLatestDebugSeq() {
    try { return Number(await this.eval("window.__typoraMcpDebug.latestSeq()")); } catch { return 0; }
  }
}

export class AutoTyporaTools {
  readonly remote = new RemoteControlTools();
  readonly cdp = new TyporaTools();
  #selected: "remote" | "cdp" | null = null;

  async #backend() {
    const forced = process.env.TYPORA_BACKEND;
    if (forced === "cdp") return this.cdp;
    if (forced === "remote-control") return this.remote;
    if (this.#selected === "remote" && await this.remote.available()) return this.remote;
    if (this.#selected === "cdp") return this.cdp;
    if (await this.remote.available()) {
      this.#selected = "remote";
      return this.remote;
    }
    this.#selected = "cdp";
    return this.cdp;
  }

  async status() { return (await this.#backend()).status(); }
  async launch(options: LaunchOptions & { restartIfNeeded?: boolean } = {}) { return (await this.#backend()).launch(options); }
  async close(force = false) { return (await this.#backend()).close(force); }
  async reload(targetId?: string, ignoreCache = false) { return (await this.#backend()).reload(targetId, ignoreCache); }
  async getDom(options: any) { return (await this.#backend()).getDom(options); }
  async querySelector(options: any) { return (await this.#backend()).querySelector(options); }
  async getElement(options: any) { return (await this.#backend()).getElement(options); }
  async executeJavascript(options: any) { return (await this.#backend()).executeJavascript(options); }
  async sendCdpCommand(options: any) { return (await this.#backend()).sendCdpCommand(options); }
  async getConsoleLogs(options: any) { return (await this.#backend()).getConsoleLogs(options); }
  async getJavascriptErrors(options: any) { return (await this.#backend()).getJavascriptErrors(options); }
  async getNetworkRequests(options: any) { return (await this.#backend()).getNetworkRequests(options); }
  async clearDebugEvents(targetId?: string) { return (await this.#backend()).clearDebugEvents(targetId); }
  async click(options: any) { return (await this.#backend()).click(options); }
  async type(options: any) { return (await this.#backend()).type(options); }
  async pressKey(options: any) { return (await this.#backend()).pressKey(options); }
  async scroll(options: any) { return (await this.#backend()).scroll(options); }
  async takeScreenshot(options?: any) { return (await this.#backend()).takeScreenshot(options); }
}

function json(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function truncate(value: string, maxChars: number) {
  return { value: value.slice(0, maxChars), truncated: value.length > maxChars, originalChars: value.length };
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

const DEBUG_OBSERVER_SCRIPT = `(()=>{if(window.__typoraMcpDebug)return true;const max=1000,state={seq:0,events:[],listeners:new WeakMap(),latestSeq(){return this.seq},push(type,payload){this.events.push({seq:++this.seq,timestamp:new Date().toISOString(),type,payload});if(this.events.length>max)this.events.shift()},safe(value){try{if(value===undefined)return null;return JSON.parse(JSON.stringify(value))}catch{return String(value)}},summary(e){return{tag:e&&e.tagName?e.tagName.toLowerCase():null,id:e&&e.id||null,className:e&&typeof e.className==='string'?e.className:null}},getListeners(e){const list=this.listeners.get(e)||[];return list.map(x=>({type:x.type,useCapture:x.options&&x.options.capture===true,passive:x.options&&x.options.passive===true,once:x.options&&x.options.once===true}))},read(type,after,limit,levels,url){let a=this.events.filter(e=>e.seq>after&&e.type===type);if(levels&&levels.length)a=a.filter(e=>levels.indexOf(e.payload.level)>=0);if(url)a=a.filter(e=>String(e.payload.url||'').indexOf(url)>=0);return{events:a.slice(0,limit),oldestAvailableSeq:this.events[0]?this.events[0].seq:this.seq,latestSeq:this.seq,truncated:a.length>limit}},clear(){this.events=[]}};['log','info','warn','error','debug'].forEach(level=>{const original=console[level];console[level]=function(){state.push('console',{level,text:Array.prototype.map.call(arguments,x=>typeof x==='string'?x:String(x)).join(' '),args:Array.prototype.map.call(arguments,state.safe.bind(state))});return original&&original.apply(this,arguments)}});window.addEventListener('error',e=>state.push('error',{name:e.error&&e.error.name||'Error',message:e.message||String(e.error||'error'),stack:e.error&&e.error.stack||null}));window.addEventListener('unhandledrejection',e=>state.push('error',{name:'UnhandledRejection',message:String(e.reason),stack:e.reason&&e.reason.stack||null}));const add=EventTarget.prototype.addEventListener;EventTarget.prototype.addEventListener=function(type,listener,options){let a=state.listeners.get(this);if(!a){a=[];state.listeners.set(this,a)}a.push({type,listener,options});return add.call(this,type,listener,options)};if(window.fetch){const fetch=window.fetch;window.fetch=function(){const started=Date.now(),args=arguments,url=String(args[0]&&args[0].url||args[0]);return fetch.apply(this,args).then(r=>{state.push('network',{phase:'response',url,status:r.status,timingMs:Date.now()-started});return r},e=>{state.push('network',{phase:'failed',url,errorText:String(e),timingMs:Date.now()-started});throw e})}};window.__typoraMcpDebug=state;return true})()`;
