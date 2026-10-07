import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DiagnosticRecorder } from "../src/diagnostics.js";

test("diagnostic traces keep safe fields and redact sensitive tool input", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "typora-mcp-diagnostics-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const recorder = new DiagnosticRecorder(root);
  const run = await recorder.start("menu-click");
  await recorder.record("click", [{ targetId: "target-1", selector: "#menu", token: "secret", text: "private" }], { clicked: true });
  await recorder.record("execute_javascript", [{ expression: "document.body.innerHTML", debugToken: "secret" }], { value: "private" });
  const error = Object.assign(new Error("token=secret expression=document.body"), { code: "SOURCE_EDIT_FORBIDDEN" });
  await recorder.recordError("type", [], error);

  const report = await recorder.report(run.runId);
  const trace = JSON.stringify(report.entries);
  assert.match(trace, /target-1/);
  assert.match(trace, /#menu/);
  assert.doesNotMatch(trace, /secret|private|document\.body/);
  assert.equal(report.overview.error?.code, "SOURCE_EDIT_FORBIDDEN");
  const finished = await recorder.finish();
  assert.ok(finished.endedAt);
  assert.equal((await recorder.status()).activeRun, null);
});

test("cleanup archives full runs after fourteen days and warns without deleting archives", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "typora-mcp-diagnostics-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const old = new Date("2026-09-01T00:00:00.000Z").getTime();
  const recorder = new DiagnosticRecorder(root, { now: () => old, archiveLimitBytes: 1 });
  const run = await recorder.start("old-failure");
  await recorder.record("typora_status", [], { targetId: "target-1" });

  const cleanup = await new DiagnosticRecorder(root, { now: () => old + 15 * 24 * 60 * 60 * 1000, archiveLimitBytes: 1 }).cleanup();
  assert.deepEqual(cleanup.archivedRunIds, [run.runId]);
  assert.equal(cleanup.storageWarning, true);
  await assert.rejects(access(run.directory));
  const archive = join(root, "archives", "2026-09", run.runId + ".json.gz");
  const restored = JSON.parse(gunzipSync(await readFile(archive)).toString("utf8"));
  assert.equal(restored.summary.runId, run.runId);
  assert.ok(restored.files["summary.json"]);
  await access(join(root, "archive-index.jsonl"));
  assert.equal((await new DiagnosticRecorder(root).report(run.runId)).summary.runId, run.runId);
});
