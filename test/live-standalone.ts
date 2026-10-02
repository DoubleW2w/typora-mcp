import assert from "node:assert/strict";
import { StandaloneTyporaTools } from "../src/standalone-tools.js";

const tools = new StandaloneTyporaTools();
const status = await tools.status();
const targetId = process.env.TYPORA_MCP_LIVE_TARGET_ID ?? status.activeTargetId;

if (!targetId) {
  throw new Error(
    "No unique standalone bridge target is connected. Start Typora after typora_install_bridge, or set TYPORA_MCP_LIVE_TARGET_ID.",
  );
}

const before = await tools.getDocumentSource({ targetId, maxChars: 1 });
const snapshot = await tools.snapshot({ targetId, selector: "#write", limit: 1 });
assert.equal(snapshot.targetId, targetId);
assert.ok(snapshot.editor);
assert.ok(snapshot.editor.visible);

const editor = await tools.getElement({ targetId, selector: "#write", includeStyles: true });
assert.equal(editor.attributes.id, "write");
assert.equal(editor.visible, true);

await tools.scroll({ targetId, selector: "#write", deltaY: 1 });
const after = await tools.getDocumentSource({ targetId, maxChars: 1 });
assert.equal(after.sourceHash, before.sourceHash);

console.log("Standalone Typora live test passed for target " + targetId);
