import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("STDIO server advertises the complete Typora debugging surface", async () => {
  const serverPath = fileURLToPath(new URL("../src/index.js", import.meta.url));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    stderr: "pipe",
  });
  const client = new Client({ name: "test-client", version: "1.0.0" });

  try {
    await client.connect(transport);
    const result = await client.listTools();
    assert.deepEqual(
      result.tools.map((tool) => tool.name).sort(),
      [
        "clear_debug_events",
        "click",
        "get_console_logs",
        "get_dom",
        "typora_get_document_source",
        "get_element",
        "get_javascript_errors",
        "get_network_requests",
        "press_key",
        "query_selector",
        "scroll",
        "send_cdp_command",
        "take_screenshot",
        "type",
        "typora_bridge_status",
        "typora_capabilities",
        "typora_diagnostic_cleanup",
        "typora_diagnostic_finish",
        "typora_diagnostic_report",
        "typora_diagnostic_start",
        "typora_diagnostic_status",
        "typora_enable_debug_network_capture",
        "typora_disable_debug_network_capture",
        "typora_close",
        "typora_install_bridge",
        "typora_launch",
        "typora_open_document",
        "typora_reload",
        "typora_restart",
        "typora_run_fixture",
        "typora_snapshot",
        "typora_status",
        "typora_uninstall_bridge",
      ].sort(),
    );
    const status = await client.callTool({ name: "typora_status", arguments: {} });
    assert.equal(status.isError, undefined);
    assert.equal((status.structuredContent as { ok?: boolean })?.ok, true);
  } finally {
    await client.close();
  }
});
