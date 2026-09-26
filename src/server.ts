import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function createServer(): McpServer {
  const server = new McpServer(
    { name: "typora-mcp", version: "0.1.0" },
    {
      instructions:
        "Inspect status before acting. Prefer DOM tools over JavaScript and raw CDP. Use event sequence numbers to compare state before and after an action.",
    },
  );

  server.registerTool(
    "typora_status",
    {
      description: "Report whether Typora and its debug renderer are available.",
      annotations: { readOnlyHint: true },
    },
    async () => ({
      content: [{ type: "text", text: "Typora status is not connected yet." }],
      structuredContent: { ok: true, data: { running: false, connected: false } },
    }),
  );

  return server;
}
