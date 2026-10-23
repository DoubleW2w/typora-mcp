import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { standaloneBridgeSource } from "../src/standalone-bridge.js";
import { StandaloneBridgeClient } from "../src/standalone-client.js";
import { StandaloneTyporaTools } from "../src/standalone-tools.js";

function bridge(allowSourceEdit?: unknown) {
  const inserted: string[] = [];
  const ranges: string[] = [];
  const sidebar = { tagName: "DIV", isContentEditable: false, contains(node: unknown) { return node === this; }, focus() {},
    getAttribute: () => null, getAttributeNames: () => [],
    getBoundingClientRect: () => ({ x: 0, y: 0, width: 100, height: 100 }) };
  const element = {
    tagName: "DIV", innerText: "original", textContent: "original",
    contains: (node: unknown) => node === element || node === paragraph,
    focus() {}, getAttribute: () => null, getAttributeNames: () => [],
    getBoundingClientRect: () => ({ x: 0, y: 0, width: 100, height: 100 }),
  };
  const paragraph = { ...element, contains: (node: unknown) => node === paragraph };
  const body = { ...element, contains: (node: unknown) => node === body || element.contains(node) };
  const panel = { ...element, isContentEditable: true, contains: (node: unknown) => node === panel, dispatchEvent() {} };
  const selection = {
    rangeCount: 1, anchorNode: element, focusNode: element,
    removeAllRanges: () => ranges.push("remove"),
    addRange: () => ranges.push("add"),
  };
  const input = { ...element, tagName: "INPUT", value: "original", contains: (node: unknown) => node === input, dispatchEvent() {} };
  const file = { isLocked: false, editor: { insertText: (text: string) => inserted.push(text) } };
  let rangeTarget: unknown;
  let handler: (request: any, response: any) => void;
  const require = createRequire(import.meta.url);
  runInNewContext(standaloneBridgeSource, {
    window: {
      __TYPORA_MCP_BRIDGE_CONFIG__: { registryDir: "unused", token: "test-token", allowSourceEdit },
      reqnode: (name: string) => name === "http" ? {
        createServer: (callback: typeof handler) => { handler = callback; return { listen() {} }; },
      } : require(name),
      File: file, addEventListener() {}, getSelection: () => selection,
    },
    document: {
      querySelector: () => element,
      querySelectorAll: (selector: string) => [selector === "#search" ? input : selector === "body" ? body : selector === "#sidebar" ? sidebar : selector === "#panel" ? panel : selector === ".md-paragraph" ? paragraph : element],
      execCommand: (command: string) => { if (command === "insertText") inserted.push(rangeTarget === panel ? "panel-input" : "unexpected-editor-edit"); return true; },
      createRange: () => ({
        selectNodeContents: (node: unknown) => { rangeTarget = node; ranges.push("select"); },
        collapse: (start: boolean) => ranges.push("collapse:" + start),
      }),
    },
    getComputedStyle: () => ({ display: "block", visibility: "visible", opacity: "1" }),
    console: { log() {}, error() {}, warn() {}, info() {}, debug() {} },
    Event,
  });
  const call = (method: string, params: object = {}) => new Promise<any>((resolve) => {
    const request = Object.assign(new EventEmitter(), {
      method: "POST", headers: { authorization: "Bearer test-token" }, setEncoding() {},
    });
    handler(request, { writeHead() {}, end: (body: string) => resolve(JSON.parse(body)) });
    request.emit("data", JSON.stringify({ method, params }));
    request.emit("end");
  });
  return { call, inserted, ranges, file, selection, input };
}

test("editor input requires an explicit boolean opt-in", async () => {
  for (const value of [undefined, false, "true"]) {
    const target = bridge(value);
    assert.equal((await target.call("capabilities")).result.sourceEdit, false);
    const response = await target.call("type", { selector: "#write", text: "test" });
    assert.equal(response.error.message, "SOURCE_EDIT_FORBIDDEN");
    assert.deepEqual(target.inserted, []);
  }
});

test("opted-in editor input uses Typora insertion and preserves the caret", async () => {
  const target = bridge(true);
  assert.equal((await target.call("capabilities")).result.sourceEdit, true);
  assert.equal((await target.call("capabilities")).result.debugEval, false);
  assert.ok((await target.call("type", { selector: "#write", text: "[^1]", clear: false })).result);
  assert.deepEqual(target.inserted, ["[^1]"]);
  assert.deepEqual(target.ranges, []);
});

test("editor input retains the existing clear-by-default behavior", async () => {
  const target = bridge(true);
  assert.ok((await target.call("type", { selector: "#write", text: "replacement" })).result);
  assert.deepEqual(target.inserted, ["replacement"]);
  assert.deepEqual(target.ranges, ["select", "remove", "add"]);
});

test("clear selects only the requested element; absent caret appends within it", async () => {
  const target = bridge(true);
  await target.call("type", { selector: "#write", text: "replacement", clear: true });
  assert.deepEqual(target.ranges, ["select", "remove", "add"]);
  target.ranges.length = 0;
  target.selection.rangeCount = 0;
  await target.call("type", { selector: "#write", text: "append", clear: false });
  assert.deepEqual(target.ranges, ["select", "collapse:false", "remove", "add"]);
});

test("ordinary input fields still replace their value by default", async () => {
  const target = bridge();
  assert.ok((await target.call("type", { selector: "#search", text: "new" })).result);
  assert.equal(target.input.value, "new");
  await target.call("type", { selector: "#search", text: " query", clear: false });
  assert.equal(target.input.value, "new query");
});

test("read-only fixture input scopes an external editable control after the editor held selection", async () => {
  const target = bridge(true);
  assert.ok((await target.call("typeReadOnly", { selector: "#panel", text: "test", clear: false })).result);
  assert.deepEqual(target.ranges, ["select", "collapse:false", "remove", "add"]);
  assert.deepEqual(target.inserted, ["panel-input"]);
});

test("fixtures forbid editor input even when enabled, while control input remains available", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "typora-mcp-input-test-"));
  const fixtureRoot = join(root, "fixtures");
  const fixturePath = join(fixtureRoot, "case.json");
  const documentPath = join(fixtureRoot, "case.md");
  const previousFixtureRoot = process.env.TYPORA_MCP_FIXTURE_ROOT;
  const previousEvidenceRoot = process.env.TYPORA_MCP_EVIDENCE_ROOT;
  t.after(async () => {
    if (previousFixtureRoot === undefined) delete process.env.TYPORA_MCP_FIXTURE_ROOT;
    else process.env.TYPORA_MCP_FIXTURE_ROOT = previousFixtureRoot;
    if (previousEvidenceRoot === undefined) delete process.env.TYPORA_MCP_EVIDENCE_ROOT;
    else process.env.TYPORA_MCP_EVIDENCE_ROOT = previousEvidenceRoot;
    await rm(root, { recursive: true, force: true });
  });
  process.env.TYPORA_MCP_FIXTURE_ROOT = fixtureRoot;
  process.env.TYPORA_MCP_EVIDENCE_ROOT = join(root, "evidence");
  await mkdir(fixtureRoot);
  await writeFile(documentPath, "# original");
  const target = bridge(true);
  const client = new StandaloneBridgeClient();
  let supportsReadOnlyInput = true;
  t.mock.method(client, "call", async (method: string, params: object) => {
    if (method === "typeReadOnly" && !supportsReadOnlyInput) throw new Error("METHOD_NOT_FOUND");
    if (method === "getDocumentSource") return { path: documentPath, sourceHash: "unchanged" };
    if (method === "snapshot") return { nodes: [] };
    if (method === "debugEvents") return { events: [] };
    const response = await target.call(method, params);
    if (response.error) throw new Error(response.error.message);
    return response.result;
  });
  const tools = new StandaloneTyporaTools(undefined, client);
  t.mock.method(tools, "status", async () => ({ latestDebugSeq: 0 }));
  for (const selector of ["#write", ".md-paragraph", "body", "#sidebar"]) {
    await writeFile(fixturePath, JSON.stringify({
      version: 1, document: "case.md",
      actions: [{ type: "type", selector, text: "forbidden", clear: true }],
    }));
    await assert.rejects(tools.runFixture({ fixturePath, targetId: "test", allowSharedTarget: true }), /SOURCE_EDIT_FORBIDDEN/);
    assert.deepEqual(target.inserted, []);
    assert.deepEqual(target.ranges, []);
    assert.equal(await readFile(documentPath, "utf8"), "# original");
  }
  await writeFile(fixturePath, JSON.stringify({
    version: 1, document: "case.md",
    actions: [{ type: "type", selector: "#search", text: "query" }],
  }));
  const result = await tools.runFixture({ fixturePath, targetId: "test", allowSharedTarget: true });
  assert.equal(result.passed, true);
  assert.equal(target.input.value, "query");
  target.input.value = "preserved";
  supportsReadOnlyInput = false;
  await assert.rejects(tools.runFixture({ fixturePath, targetId: "test", allowSharedTarget: true }), /METHOD_NOT_FOUND/);
  assert.equal(target.input.value, "preserved");
  await tools.type({ selector: "#write", text: "allowed outside fixture" });
  assert.deepEqual(target.inserted, ["allowed outside fixture"]);
});

test("locked documents remain unchanged even with editor input enabled", async () => {
  const target = bridge(true);
  target.file.isLocked = true;
  const response = await target.call("type", { selector: "#write", text: "test" });
  assert.equal(response.error.message, "EDITOR_INPUT_UNAVAILABLE");
  assert.deepEqual(target.inserted, []);
  assert.deepEqual(target.ranges, []);
});
