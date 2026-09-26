import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { TyporaTools } from "../src/tools.js";

const tools = new TyporaTools();
const initial = await tools.status();
const launchedByTest = !initial.running;

try {
  const status = launchedByTest ? await tools.launch() : initial;
  if (!status.rendererConnected) {
    throw new Error(
      "Typora is running without CDP. Close it and rerun npm run test:live, or start it with --remote-debugging-port=9222.",
    );
  }
  const targetId = status.activeTargetId ?? (status.targets.length === 1 ? status.targets[0]!.targetId : undefined);
  if (!targetId) throw new Error("Multiple Typora windows are open and none is focused");

  const evaluated = await tools.executeJavascript({ targetId, expression: "1 + 1" });
  assert.equal(evaluated.value, 2);
  assert.ok((await tools.getDom({ targetId, selector: "body", format: "html" })).originalChars > 0);

  const afterSeq = tools.session.observer.latestSeq();
  await tools.executeJavascript({
    targetId,
    expression: `(() => {
      document.getElementById("__typora_mcp_live__")?.remove();
      const root = document.createElement("div");
      root.id = "__typora_mcp_live__";
      root.style.cssText = "position:fixed;left:8px;bottom:8px;z-index:2147483647;background:white;padding:8px";
      root.innerHTML = '<input id="__typora_mcp_input__"><button id="__typora_mcp_button__">MCP live test</button>';
      root.querySelector("button").addEventListener("click", () => console.log("__typora_mcp_clicked__"));
      document.body.appendChild(root);
      return true;
    })()`,
  });
  await tools.type({ targetId, selector: "#__typora_mcp_input__", text: "works" });
  await tools.click({ targetId, selector: "#__typora_mcp_button__" });
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.ok(
    tools
      .getConsoleLogs({ targetId, afterSeq })
      .events.some((event) => String(event.payload.text).includes("__typora_mcp_clicked__")),
  );

  const screenshot = await tools.takeScreenshot({ targetId });
  assert.ok(screenshot.length > 0);
  await mkdir("screenshots", { recursive: true });
  await writeFile(path.join("screenshots", "live.png"), screenshot);

  await tools.reload(targetId);
  console.log("Typora live test passed; screenshot: screenshots/live.png");
} finally {
  if (launchedByTest) await tools.close(false);
}
