import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { TyporaSessionError } from "./typora-session.js";
import { TyporaToolError, TyporaTools } from "./tools.js";

const targetId = z.string().optional().describe("Renderer targetId from typora_status; required when no single window is focused");
const selector = z.string().min(1).describe("CSS selector evaluated in the selected Typora renderer");

export function createServer(tools = new TyporaTools()): McpServer {
  const server = new McpServer(
    { name: "typora-mcp", version: "0.1.0" },
    {
      instructions:
        "Call typora_status first. Prefer DOM and UI tools over execute_javascript, and execute_javascript over raw CDP. Record latestDebugSeq before reproducing a bug, then fetch events with afterSeq. Pass targetId when multiple Typora windows exist.",
    },
  );

  server.registerTool(
    "typora_status",
    {
      description: "Inspect Typora processes, CDP connectivity, renderer windows, current file, and latest debug event sequence.",
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => result(() => tools.status()),
  );

  server.registerTool(
    "typora_launch",
    {
      description: "Find and launch Typora with CDP enabled, then wait until a renderer is ready.",
      inputSchema: {
        executablePath: z.string().optional(),
        filePath: z.string().optional(),
        debugPort: z.number().int().min(1).max(65535).optional(),
        extraArgs: z.array(z.string()).optional(),
        restartIfNeeded: z.boolean().optional().default(false),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (input) => result(() => tools.launch(input)),
  );

  server.registerTool(
    "typora_close",
    {
      description: "Close Typora normally so unsaved prompts can appear; force termination only when force is true.",
      inputSchema: { force: z.boolean().optional().default(false) },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ force }) => result(() => tools.close(force)),
  );

  server.registerTool(
    "typora_reload",
    {
      description: "Reload the selected Typora renderer and wait for DOMContentLoaded.",
      inputSchema: { targetId, ignoreCache: z.boolean().optional().default(false) },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ targetId, ignoreCache }) => result(() => tools.reload(targetId, ignoreCache)),
  );

  server.registerTool(
    "get_dom",
    {
      description: "Read bounded HTML, visible text, or an accessibility snapshot from Typora.",
      inputSchema: {
        targetId,
        selector: z.string().optional().default("html"),
        format: z.enum(["html", "text", "accessibility"]).optional().default("html"),
        maxChars: z.number().int().min(1).max(500_000).optional().default(50_000),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input) => result(() => tools.getDom(input)),
  );

  server.registerTool(
    "query_selector",
    {
      description: "List concise, serializable summaries for elements matching a CSS selector.",
      inputSchema: { targetId, selector, limit: z.number().int().min(1).max(500).optional().default(50) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input) => result(() => tools.querySelector(input)),
  );

  server.registerTool(
    "get_element",
    {
      description: "Inspect one element's attributes, geometry, computed styles, accessibility, and event listeners.",
      inputSchema: {
        targetId,
        selector,
        index: z.number().int().min(0).optional(),
        includeStyles: z.boolean().optional().default(true),
        includeListeners: z.boolean().optional().default(true),
        includeAccessibility: z.boolean().optional().default(true),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input) => result(() => tools.getElement(input)),
  );

  server.registerTool(
    "execute_javascript",
    {
      description: "Evaluate JavaScript in the selected Typora renderer, like the Developer Tools Console.",
      inputSchema: {
        targetId,
        expression: z.string().min(1),
        awaitPromise: z.boolean().optional().default(true),
        timeoutMs: z.number().int().min(1).max(120_000).optional().default(10_000),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    async (input) => result(() => tools.executeJavascript(input)),
  );

  server.registerTool(
    "send_cdp_command",
    {
      description: "Send an arbitrary Chrome DevTools Protocol command to the selected Typora renderer.",
      inputSchema: { targetId, method: z.string().min(1), params: z.record(z.unknown()).optional() },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    async (input) => result(() => tools.sendCdpCommand(input)),
  );

  server.registerTool(
    "get_console_logs",
    {
      description: "Read captured console events, optionally only those after a previous sequence number.",
      inputSchema: {
        targetId,
        afterSeq: z.number().int().min(0).optional(),
        levels: z.array(z.string()).optional(),
        limit: z.number().int().min(1).max(1_000).optional().default(100),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input) => result(() => tools.getConsoleLogs(input)),
  );

  server.registerTool(
    "get_javascript_errors",
    {
      description: "Read captured uncaught errors and unhandled promise rejections.",
      inputSchema: {
        targetId,
        afterSeq: z.number().int().min(0).optional(),
        limit: z.number().int().min(1).max(1_000).optional().default(100),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input) => result(() => tools.getJavascriptErrors(input)),
  );

  server.registerTool(
    "get_network_requests",
    {
      description: "Read captured request, response, and failure events; response bodies are opt-in and bounded.",
      inputSchema: {
        targetId,
        afterSeq: z.number().int().min(0).optional(),
        urlPattern: z.string().optional(),
        limit: z.number().int().min(1).max(1_000).optional().default(100),
        includeBodies: z.boolean().optional().default(false),
        maxBodyChars: z.number().int().min(1).max(200_000).optional().default(20_000),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input) => result(() => tools.getNetworkRequests(input)),
  );

  server.registerTool(
    "clear_debug_events",
    {
      description: "Clear captured debug events for one renderer or all renderers without resetting sequence numbers.",
      inputSchema: { targetId },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ targetId }) => result(() => tools.clearDebugEvents(targetId)),
  );

  server.registerTool(
    "click",
    {
      description: "Click a visible element through Playwright/CDP; pass index when the selector matches more than one.",
      inputSchema: { targetId, selector, index: z.number().int().min(0).optional() },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    async (input) => result(() => tools.click(input)),
  );

  server.registerTool(
    "type",
    {
      description: "Enter text into a selected Typora element through Playwright/CDP.",
      inputSchema: {
        targetId,
        selector,
        index: z.number().int().min(0).optional(),
        text: z.string(),
        clear: z.boolean().optional().default(true),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    async (input) => result(() => tools.type(input)),
  );

  server.registerTool(
    "press_key",
    {
      description: "Press a Playwright key on a selected element or the active page.",
      inputSchema: {
        targetId,
        key: z.string().min(1),
        selector: z.string().optional(),
        index: z.number().int().min(0).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    async (input) => result(() => tools.pressKey(input)),
  );

  server.registerTool(
    "scroll",
    {
      description: "Scroll an element or the selected Typora page by a pixel delta.",
      inputSchema: {
        targetId,
        selector: z.string().optional(),
        deltaX: z.number().optional().default(0),
        deltaY: z.number(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (input) => result(() => tools.scroll(input)),
  );

  server.registerTool(
    "take_screenshot",
    {
      description: "Capture the selected Typora page or one matching element as a PNG image.",
      inputSchema: { targetId, selector: z.string().optional(), fullPage: z.boolean().optional().default(false) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input) => {
      try {
        const image = await tools.takeScreenshot(input);
        return {
          content: [{ type: "image" as const, data: image.toString("base64"), mimeType: "image/png" }],
          structuredContent: { ok: true, data: { mimeType: "image/png", bytes: image.length } },
        };
      } catch (error) {
        return failure(error);
      }
    },
  );

  return server;
}

async function result(action: () => unknown | Promise<unknown>) {
  try {
    const data = await action();
    return {
      content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      structuredContent: { ok: true, data: data as Record<string, unknown> },
    };
  } catch (error) {
    return failure(error);
  }
}

function failure(error: unknown) {
  const code =
    error instanceof TyporaToolError || error instanceof TyporaSessionError
      ? error.code
      : error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.name)
        ? error.name
        : "INTERNAL_ERROR";
  const message = error instanceof Error ? error.message : String(error);
  return {
    isError: true,
    content: [{ type: "text" as const, text: `${code}: ${message}` }],
    structuredContent: { ok: false, error: { code, message } },
  };
}
