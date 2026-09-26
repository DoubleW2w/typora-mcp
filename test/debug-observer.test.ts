import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import type { Page } from "playwright-core";
import { DebugEventBuffer } from "../src/debug-events.js";
import { DebugObserver } from "../src/debug-observer.js";

test("observer converts page console and error events into serializable records", async () => {
  const page = new EventEmitter();
  const events = new DebugEventBuffer();
  const observer = new DebugObserver(events);
  observer.attach(page as unknown as Page, "target-1");

  page.emit("console", {
    type: () => "warning",
    text: () => "value 7",
    location: () => ({ url: "file:///note", lineNumber: 3, columnNumber: 2 }),
    args: () => [{ jsonValue: async () => ({ value: 7 }) }],
  });
  page.emit("pageerror", Object.assign(new Error("broken"), { name: "TypeError" }));
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(observer.console().events[0]?.payload, {
    level: "warning",
    text: "value 7",
    args: [{ value: 7 }],
    location: { url: "file:///note", lineNumber: 3, columnNumber: 2 },
  });
  assert.equal(observer.errors().events[0]?.payload.message, "broken");
});

test("observer correlates network request, response, and failure events", async () => {
  const page = new EventEmitter();
  const observer = new DebugObserver(new DebugEventBuffer());
  observer.attach(page as unknown as Page, "target-1");
  const request = {
    url: () => "https://example.test/data",
    method: () => "GET",
    resourceType: () => "fetch",
    postData: () => null,
    failure: () => ({ errorText: "net::ERR_FAILED" }),
  };
  page.emit("request", request);
  page.emit("requestfailed", request);
  await new Promise((resolve) => setImmediate(resolve));

  const records = await observer.network();
  assert.deepEqual(records.events.map((event) => event.payload.phase), ["request", "failed"]);
  assert.equal(records.events[0]?.payload.requestId, records.events[1]?.payload.requestId);
});
