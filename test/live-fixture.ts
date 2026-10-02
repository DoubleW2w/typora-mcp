import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StandaloneTyporaTools } from "../src/standalone-tools.js";

process.env.TYPORA_MCP_FIXTURE_ROOT = join(process.cwd(), "test", "fixtures");
process.env.TYPORA_MCP_EVIDENCE_ROOT = await mkdtemp(join(tmpdir(), "typora-mcp-evidence-"));

const tools = new StandaloneTyporaTools();
try {
  const result = await tools.runFixture({ fixturePath: join(process.env.TYPORA_MCP_FIXTURE_ROOT, "standalone-live.json") });
  assert.equal(result.passed, true);
  await access(join(result.evidenceDirectory, "run.json"));
  await access(join(result.evidenceDirectory, "source.json"));
  await access(join(result.evidenceDirectory, "snapshot.json"));
  await access(join(result.evidenceDirectory, "events.json"));
  await access(join(result.evidenceDirectory, "assertions.json"));
  const eventEvidence = JSON.parse(await readFile(join(result.evidenceDirectory, "events.json"), "utf8"));
  const networkPhases = eventEvidence.events
    .filter((event: any) => event.payload?.source === "debugCapture")
    .map((event: any) => event.payload.phase);
  assert.ok(networkPhases.includes("request"));
  assert.ok(networkPhases.includes("response"));
  assert.ok(networkPhases.includes("failure"));
  const status = await tools.status();
  const targetId = status.activeTargetId;
  assert.ok(targetId);
  const snapshot = await tools.snapshot({ targetId, rootSelector: "#write", limit: 1 });
  assert.ok(snapshot.editor?.ref);
  const editor = await tools.getElement({ targetId, snapshotId: snapshot.snapshotId, ref: snapshot.editor.ref });
  assert.equal(editor.attributes.id, "write");
  await assert.rejects(
    tools.type({ targetId, snapshotId: snapshot.snapshotId, ref: snapshot.editor.ref, text: "must not write" }),
    /SOURCE_EDIT_FORBIDDEN/,
  );
  await tools.scroll({ targetId, snapshotId: snapshot.snapshotId, ref: snapshot.editor.ref, deltaY: 1 });
  await assert.rejects(
    tools.getElement({ targetId, snapshotId: snapshot.snapshotId, ref: snapshot.editor.ref }),
    /SNAPSHOT_EXPIRED/,
  );
  console.log("Standalone Typora fixture passed: " + result.evidenceDirectory);
} finally {
  if (tools.process.status().running) await tools.close(false);
  await rm(process.env.TYPORA_MCP_EVIDENCE_ROOT, { recursive: true, force: true });
}
