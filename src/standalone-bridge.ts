// This source is copied beside Typora's window.html by the explicit installer.
// It deliberately uses only renderer DOM APIs plus Typora's exposed reqnode.
export const standaloneBridgeVersion = 1;
export const standaloneBridgeSource = String.raw`/* typora-mcp standalone renderer bridge */
(() => {
  "use strict";
  if (window.__TYPORA_MCP_BRIDGE__) return;

  const config = window.__TYPORA_MCP_BRIDGE_CONFIG__;
  const reqnode = window.reqnode;
  if (!config || !config.registryDir || !config.token || typeof reqnode !== "function") return;

  const http = reqnode("http");
  const fs = reqnode("fs");
  const path = reqnode("path");
  const crypto = reqnode("crypto");
  const bridgeVersion = 1;
  const targetId = crypto.randomBytes(12).toString("hex");
  const events = [];
  let nextElementRef = 1;
  let nextEventSeq = 1;
  let revision = 0;
  let registryPath = null;
  let debugNetworkCapture = false;
  let networkCaptureOriginals = null;
  const snapshots = new Map();

  function safe(value) {
    try {
      if (typeof value === "string") return value.slice(0, 4000);
      return JSON.stringify(value).slice(0, 4000);
    } catch {
      return String(value).slice(0, 4000);
    }
  }

  function record(type, payload) {
    events.push({ seq: nextEventSeq++, at: new Date().toISOString(), type: type, payload: payload });
    if (events.length > 500) events.shift();
  }

  function invalidateSnapshots() {
    revision += 1;
    snapshots.clear();
  }

  function isVisible(element) {
    const style = getComputedStyle(element);
    const box = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0 && box.width > 0 && box.height > 0;
  }

  function attributes(element) {
    const result = {};
    element.getAttributeNames().forEach((name) => {
      if (name === "class" || name === "id" || name === "role" || name.startsWith("aria-") || name.startsWith("data-")) {
        result[name] = element.getAttribute(name);
      }
    });
    return result;
  }

  function describe(element, styles, refs, maxTextChars) {
    const box = element.getBoundingClientRect();
    const computed = getComputedStyle(element);
    const ref = refs ? "e" + nextElementRef++ : undefined;
    if (refs) refs.set(ref, element);
    return {
      ref: ref,
      role: element.getAttribute("role") || undefined,
      tag: element.tagName.toLowerCase(),
      text: (element.innerText || element.textContent || "").trim().slice(0, maxTextChars || 1000),
      attributes: attributes(element),
      visible: isVisible(element),
      box: { x: box.x, y: box.y, width: box.width, height: box.height },
      styles: styles ? {
        display: computed.display,
        visibility: computed.visibility,
        opacity: computed.opacity,
        position: computed.position,
        pointerEvents: computed.pointerEvents,
      } : undefined,
    };
  }

  function selected(params) {
    if (params.ref) {
      const snapshot = snapshots.get(params.snapshotId);
      if (!snapshot || snapshot.expiresAt < Date.now() || snapshot.revision !== revision) {
        throw new Error("SNAPSHOT_EXPIRED");
      }
      const element = snapshot.refs.get(params.ref);
      if (!element) throw new Error("ELEMENT_REF_NOT_FOUND");
      return element;
    }
    const selector = params.selector;
    const index = params.index;
    if (!selector) throw new Error("A selector or snapshot ref is required");
    const matches = Array.from(document.querySelectorAll(selector));
    if (!matches.length) throw new Error("No element matches selector: " + selector);
    if (matches.length > 1 && index === undefined) throw new Error("Selector matches " + matches.length + " elements; pass index");
    const element = matches[index || 0];
    if (!element) throw new Error("No element at index " + index);
    return element;
  }

  function filePath() {
    const file = window.File;
    return file && (file.filePath || (file.bundle && file.bundle.filePath)) || null;
  }

  function snapshot(params) {
    const selector = params && (params.rootSelector || params.selector) ? (params.rootSelector || params.selector) : "#write, [role], button, input, textarea, select, a";
    const limit = Math.min((params && (params.maxNodes || params.limit)) || 100, 500);
    const maxTextChars = Math.min((params && params.maxTextChars) || 1000, 10000);
    const refs = new Map();
    const nodes = Array.from(document.querySelectorAll(selector)).slice(0, limit).map((element) => describe(element, true, refs, maxTextChars));
    const html = document.documentElement.outerHTML;
    invalidateSnapshots();
    const snapshotId = targetId + ":s" + revision;
    snapshots.set(snapshotId, { revision: revision, expiresAt: Date.now() + 120000, refs: refs });
    const currentPath = filePath();
    const source = currentPath ? fs.readFileSync(currentPath, "utf8") : null;
    const selection = window.getSelection();
    const editor = document.querySelector("#write");
    return {
      targetId: targetId,
      snapshotId: snapshotId,
      revision: revision,
      document: {
        path: currentPath,
        sourceHash: source ? crypto.createHash("sha256").update(source).digest("hex") : null,
        rendererHash: crypto.createHash("sha256").update(html).digest("hex"),
      },
      editor: editor ? {
        ...describe(editor, true, refs, maxTextChars),
        mode: "wysiwyg",
        selection: { anchorOffset: selection ? selection.anchorOffset : null, focusOffset: selection ? selection.focusOffset : null },
        cursor: { offset: selection ? selection.focusOffset : null },
      } : null,
      nodes: nodes,
      plugins: { rendererClasses: document.body.className.split(/\s+/).filter(Boolean) },
      events: { latestSeq: nextEventSeq - 1 },
    };
  }

  function getDom(params) {
    const selector = (params && params.selector) || "html";
    const format = (params && params.format) || "html";
    const maxChars = Math.min((params && params.maxChars) || 50000, 500000);
    const element = selected({ selector: selector, index: params && params.index, snapshotId: params && params.snapshotId, ref: params && params.ref });
    const content = format === "text" ? (element.innerText || element.textContent || "") : element.outerHTML;
    return { selector: selector, format: format, content: content.slice(0, maxChars), truncated: content.length > maxChars };
  }

  function getDocumentSource(params) {
    const currentPath = filePath();
    if (!currentPath) throw new Error("The current Typora document has no saved file path");
    const source = fs.readFileSync(currentPath, "utf8");
    const maxChars = Math.min((params && params.maxChars) || 500000, 1000000);
    return {
      path: currentPath,
      source: source.slice(0, maxChars),
      sourceHash: crypto.createHash("sha256").update(source).digest("hex"),
      originalChars: source.length,
      truncated: source.length > maxChars,
    };
  }

  function openDocument(params) {
    const requestedPath = params && params.path;
    if (!requestedPath || typeof requestedPath !== "string") throw new Error("A document path is required");
    const file = window.File;
    if (!file || !file.editor || !file.editor.library || typeof file.editor.library.openFile !== "function") {
      throw new Error("OPEN_DOCUMENT_UNAVAILABLE");
    }
    file.editor.library.openFile(requestedPath);
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + 5000;
      const check = () => {
        if (filePath() === requestedPath) return resolve({ path: requestedPath, opened: true });
        if (Date.now() >= deadline) return reject(new Error("DOCUMENT_OPEN_TIMEOUT"));
        setTimeout(check, 50);
      };
      check();
    });
  }

  function querySelector(params) {
    const limit = Math.min((params && params.limit) || 50, 500);
    return Array.from(document.querySelectorAll(params.selector)).slice(0, limit).map((element) => describe(element, false));
  }

  function getElement(params) {
    return describe(selected(params), params.includeStyles !== false);
  }

  function click(params) {
    const element = selected(params);
    element.focus();
    element.click();
    invalidateSnapshots();
    return describe(element, false);
  }

  function type(params) {
    const element = selected(params);
    const editor = document.querySelector("#write");
    if (editor && editor.contains(element)) throw new Error("SOURCE_EDIT_FORBIDDEN");
    const text = String(params.text || "");
    element.focus();
    if ("value" in element) {
      if (params.clear !== false) element.value = "";
      element.value += text;
    } else {
      if (params.clear !== false) document.execCommand("selectAll", false);
      if (!document.execCommand("insertText", false, text)) element.textContent = (params.clear === false ? element.textContent : "") + text;
    }
    element.dispatchEvent(new Event("input", { bubbles: true }));
    invalidateSnapshots();
    return describe(element, false);
  }

  function pressKey(params) {
    const element = (params.selector || params.ref) ? selected(params) : document.activeElement;
    const key = String(params.key);
    element.dispatchEvent(new KeyboardEvent("keydown", { key: key, bubbles: true }));
    element.dispatchEvent(new KeyboardEvent("keyup", { key: key, bubbles: true }));
    invalidateSnapshots();
    return { key: key };
  }

  function scroll(params) {
    const target = (params.selector || params.ref) ? selected(params) : window;
    if (target === window) window.scrollBy(params.deltaX || 0, params.deltaY || 0);
    else target.scrollBy(params.deltaX || 0, params.deltaY || 0);
    invalidateSnapshots();
    return { deltaX: params.deltaX || 0, deltaY: params.deltaY || 0 };
  }

  function debugEvents(params) {
    const afterSeq = (params && params.afterSeq) || 0;
    const type = params && params.type;
    const limit = Math.min((params && params.limit) || 100, 1000);
    const matching = events.filter((event) => event.seq > afterSeq && (!type || event.type === type));
    return {
      afterSeq: afterSeq,
      events: matching.slice(0, limit),
      oldestAvailableSeq: events.length ? events[0].seq : nextEventSeq,
      latestSeq: nextEventSeq - 1,
      truncated: matching.length > limit,
    };
  }

  function clearDebugEvents() {
    events.splice(0, events.length);
    return { cleared: true, oldestAvailableSeq: nextEventSeq, latestSeq: nextEventSeq - 1 };
  }

  function enableDebugNetworkCapture() {
    if (debugNetworkCapture) return { enabled: true };
    debugNetworkCapture = true;
    const fetch = window.fetch;
    const open = XMLHttpRequest.prototype.open;
    const send = XMLHttpRequest.prototype.send;
    networkCaptureOriginals = { fetch: fetch, open: open, send: send };
    if (fetch) {
      window.fetch = function () {
        const url = String(arguments[0] && arguments[0].url || arguments[0]);
        record("network", { source: "debugCapture", phase: "request", url: url });
        return fetch.apply(this, arguments).then(
          (response) => {
            record("network", { source: "debugCapture", phase: "response", url: url, status: response.status });
            return response;
          },
          (error) => {
            record("network", { source: "debugCapture", phase: "failure", url: url, error: safe(error) });
            throw error;
          },
        );
      };
    }
    XMLHttpRequest.prototype.open = function (method, url) {
      this.__typoraMcpUrl = String(url);
      return open.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function () {
      const url = this.__typoraMcpUrl || "";
      record("network", { source: "debugCapture", phase: "request", url: url });
      this.addEventListener("loadend", () => record("network", {
        source: "debugCapture",
        phase: this.status ? "response" : "failure",
        url: url,
        status: this.status,
      }), { once: true });
      return send.apply(this, arguments);
    };
    return { enabled: true };
  }

  function disableDebugNetworkCapture() {
    if (networkCaptureOriginals) {
      window.fetch = networkCaptureOriginals.fetch;
      XMLHttpRequest.prototype.open = networkCaptureOriginals.open;
      XMLHttpRequest.prototype.send = networkCaptureOriginals.send;
    }
    networkCaptureOriginals = null;
    debugNetworkCapture = false;
    return { enabled: false };
  }

  async function networkProbe() {
    await fetch("data:text/plain,typora-mcp-network-probe");
    try {
      await fetch("http://127.0.0.1:1/typora-mcp-network-probe");
    } catch {}
    return { probed: true };
  }

  const api = {
    status: () => ({
      targetId: targetId,
      bridgeVersion: bridgeVersion,
      title: document.title,
      url: location.href,
      filePath: filePath(),
      focused: document.hasFocus(),
      latestDebugSeq: nextEventSeq - 1,
    }),
    capabilities: () => ({
      snapshot: true,
      sourceRead: true,
      resourceTiming: true,
      debugNetworkCapture: true,
      debugNetworkCaptureEnabled: debugNetworkCapture,
      screenshot: false,
      debugEval: false,
      cdp: false,
    }),
    snapshot: snapshot,
    getDom: getDom,
    getDocumentSource: getDocumentSource,
    openDocument: openDocument,
    querySelector: querySelector,
    getElement: getElement,
    click: click,
    type: type,
    pressKey: pressKey,
    scroll: scroll,
    debugEvents: debugEvents,
    clearDebugEvents: clearDebugEvents,
    enableDebugNetworkCapture: enableDebugNetworkCapture,
    disableDebugNetworkCapture: disableDebugNetworkCapture,
    networkProbe: networkProbe,
  };

  window.addEventListener("error", (event) => record("javascript-error", {
    message: event.message,
    filename: event.filename,
    line: event.lineno,
    column: event.colno,
    stack: event.error && event.error.stack,
  }));
  window.addEventListener("unhandledrejection", (event) => record("javascript-error", { message: safe(event.reason) }));

  ["debug", "info", "warn", "error", "log"].forEach((level) => {
    const original = console[level];
    if (typeof original !== "function") return;
    try {
      console[level] = function () {
        record("console", { level: level, args: Array.from(arguments).map(safe) });
        return original.apply(console, arguments);
      };
    } catch {}
  });

  if (window.PerformanceObserver) {
    try {
      new PerformanceObserver((list) => list.getEntries().forEach((entry) => record("network", {
        source: "resourceTiming",
        name: entry.name,
        initiatorType: entry.initiatorType,
        startTime: entry.startTime,
        duration: entry.duration,
        transferSize: entry.transferSize,
      }))).observe({ type: "resource", buffered: true });
    } catch {}
  }

  function reply(response, status, value) {
    response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify(value));
  }

  const server = http.createServer((request, response) => {
    if (request.method !== "POST") return reply(response, 405, { error: { code: "METHOD_NOT_ALLOWED" } });
    if (request.headers.authorization !== "Bearer " + config.token) return reply(response, 401, { error: { code: "UNAUTHORIZED" } });
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1000000) request.destroy();
    });
    request.on("end", () => {
      try {
        const call = JSON.parse(body);
        if (!call || typeof call.method !== "string" || typeof api[call.method] !== "function") throw new Error("Unknown bridge method");
        Promise.resolve(api[call.method](call.params || {}))
          .then((result) => reply(response, 200, { id: call.id || null, result: result }))
          .catch((error) => reply(response, 400, { id: call.id || null, error: { code: "BRIDGE_ERROR", message: error.message } }));
      } catch (error) {
        reply(response, 400, { error: { code: "BAD_REQUEST", message: error.message } });
      }
    });
  });

  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (!address || typeof address === "string") return;
    fs.mkdir(config.registryDir, { recursive: true }, (error) => {
      if (error) return;
      registryPath = path.join(config.registryDir, targetId + ".json");
      fs.writeFile(registryPath, JSON.stringify({
        version: 1,
        bridgeVersion: bridgeVersion,
        targetId: targetId,
        host: "127.0.0.1",
        port: address.port,
        token: config.token,
        pid: reqnode("process").pid,
        createdAt: new Date().toISOString(),
      }), "utf8", () => {});
    });
  });

  window.addEventListener("beforeunload", () => {
    server.close();
    if (registryPath) fs.unlink(registryPath, () => {});
  });
  window.__TYPORA_MCP_BRIDGE__ = { targetId: targetId };
})();`;
