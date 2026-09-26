import assert from "node:assert/strict";
import test from "node:test";
import { selectElementIndex, truncateText, TyporaToolError } from "../src/tools.js";

test("element selection requires an explicit index for multiple matches", () => {
  assert.equal(selectElementIndex(1), 0);
  assert.equal(selectElementIndex(3, 2), 2);
  assert.throws(
    () => selectElementIndex(0),
    (error: unknown) => error instanceof TyporaToolError && error.code === "SELECTOR_NOT_FOUND",
  );
  assert.throws(
    () => selectElementIndex(2),
    (error: unknown) => error instanceof TyporaToolError && error.code === "SELECTOR_AMBIGUOUS",
  );
});

test("large text results are truncated explicitly", () => {
  assert.deepEqual(truncateText("abcdef", 4), { value: "abcd", truncated: true, originalChars: 6 });
  assert.deepEqual(truncateText("abc", 4), { value: "abc", truncated: false, originalChars: 3 });
});
