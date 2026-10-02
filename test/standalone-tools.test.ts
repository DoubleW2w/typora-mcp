import assert from "node:assert/strict";
import test from "node:test";
import { selectActiveTarget } from "../src/standalone-tools.js";

test("target selection prefers a unique focused renderer and otherwise a unique live renderer", () => {
  assert.equal(
    selectActiveTarget([{ targetId: "a", focused: false }, { targetId: "b", focused: true }])?.targetId,
    "b",
  );
  assert.equal(selectActiveTarget([{ targetId: "a", focused: false }])?.targetId, "a");
  assert.equal(selectActiveTarget([{ targetId: "a" }, { targetId: "b" }]), null);
  assert.equal(selectActiveTarget([{ targetId: "a", focused: true }, { targetId: "b", focused: true }]), null);
});
