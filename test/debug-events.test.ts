import assert from "node:assert/strict";
import test from "node:test";
import { DebugEventBuffer } from "../src/debug-events.js";

test("debug events use cursors and discard only the oldest event", () => {
  const events = new DebugEventBuffer(3);

  events.push({ targetId: "a", type: "console", payload: { text: "one" } });
  events.push({ targetId: "a", type: "javascript-error", payload: { text: "two" } });
  events.push({ targetId: "b", type: "network", payload: { url: "/three" } });
  events.push({ targetId: "a", type: "console", payload: { text: "four" } });

  assert.deepEqual(
    events.query({ targetId: "a", afterSeq: 2 }).events.map((event) => event.seq),
    [4],
  );
  assert.deepEqual(events.query({ types: ["network"] }).events.map((event) => event.seq), [3]);
  assert.equal(events.query().oldestAvailableSeq, 2);
  assert.equal(events.query().latestSeq, 4);
});

test("clearing one target keeps other targets and does not reuse sequence numbers", () => {
  const events = new DebugEventBuffer();
  events.push({ targetId: "a", type: "console", payload: {} });
  events.push({ targetId: "b", type: "console", payload: {} });

  events.clear("a");
  const next = events.push({ targetId: "a", type: "console", payload: {} });

  assert.equal(next.seq, 3);
  assert.deepEqual(events.query().events.map((event) => event.seq), [2, 3]);
});
