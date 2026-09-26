import assert from "node:assert/strict";
import test from "node:test";
import { selectTarget, TyporaSessionError, type TyporaTarget } from "../src/typora-session.js";

const targets: TyporaTarget[] = [
  { targetId: "one", title: "one.md", url: "file:///one", focused: false },
  { targetId: "two", title: "two.md", url: "file:///two", focused: true },
];

test("renderer selection prefers an explicit target then the focused target", () => {
  assert.equal(selectTarget(targets, "one").targetId, "one");
  assert.equal(selectTarget(targets).targetId, "two");
});

test("renderer selection refuses to guess when focus is ambiguous", () => {
  assert.throws(
    () => selectTarget(targets.map((target) => ({ ...target, focused: false }))),
    (error: unknown) => error instanceof TyporaSessionError && error.code === "TARGET_AMBIGUOUS",
  );
  assert.throws(
    () => selectTarget([], "missing"),
    (error: unknown) => error instanceof TyporaSessionError && error.code === "RENDERER_NOT_FOUND",
  );
});
