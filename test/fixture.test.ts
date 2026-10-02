import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createEvidenceDirectory, readFixture } from "../src/fixture.js";

test("fixtures and documents cannot escape their configured root", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "typora-mcp-fixture-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "case.json"), JSON.stringify({ version: 1, document: "case.md" }));
  await writeFile(join(root, "case.md"), "# fixture");
  assert.equal((await readFixture(join(root, "case.json"), root)).documentPath, join(root, "case.md"));
  await assert.rejects(readFixture(join(root, "..", "outside.json"), root), /FIXTURE_PATH_FORBIDDEN/);
  const evidence = await createEvidenceDirectory(join(root, "evidence"));
  assert.ok(evidence.directory.startsWith(join(root, "evidence")));
});
