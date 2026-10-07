# Typora MCP

[English](README.md) | [简体中文](README.zh-CN.md)

[![MIT License](https://img.shields.io/badge/license-MIT-6C47FF.svg?style=flat-square)](LICENSE)
![Node.js 20+](https://img.shields.io/badge/node-%3E%3D20-339933.svg?style=flat-square)
![MCP](https://img.shields.io/badge/MCP-STDIO-6C47FF.svg?style=flat-square)

A local-first MCP server for inspecting, debugging, and safely automating a
running Typora instance through an opt-in renderer bridge.

> [!WARNING]
> This is an independent community project. It is not affiliated with or
> endorsed by Typora, Anthropic, or OpenAI.

## Highlights

- One local MCP server for Codex and Claude Code.
- Reversible renderer bridge for live DOM, styles, source hashes, console
  events, and fixture evidence.
- Structured snapshots and short-lived element refs instead of coordinates.
- Isolated fixture runs that prove Markdown source was not changed.

## Requirements

- Node.js 20 or newer.
- A local Typora installation.
- Permission to modify Typora resources only when you explicitly install the
  bridge.

## Install from source

    git clone https://github.com/DoubleW2w/typora-mcp.git
    cd typora-mcp
    npm install
    npm run build

This project does not publish an npm package yet. Your client starts the built
local checkout.

## Connect Codex

    codex mcp add typora -- node "<absolute-path-to-typora-mcp>/dist/src/index.js"
    codex mcp list

Or use your Codex configuration:

    [mcp_servers.typora]
    command = "node"
    args = ["<absolute-path-to-typora-mcp>/dist/src/index.js"]
    cwd = "<absolute-path-to-typora-mcp>"

    [mcp_servers.typora.env]
    TYPORA_PATH = "D:\\Typora\\Typora.exe"
    TYPORA_BACKEND = "standalone"

## Plugin distribution status

This source-release version supports the official Codex and Claude Code MCP
configuration formats, but is not yet a remote one-click plugin. A marketplace
cache does not include this project's Node dependencies. Use the source install
above, then add the local STDIO server directly.

A remote Codex/Claude plugin will be released after this project ships either
an npm package or a GitHub Release bundle containing its runtime dependencies.

## Connect Claude Code

From your cloned repository, run:

    claude mcp add typora -- node "<absolute-path-to-typora-mcp>/dist/src/index.js"
    claude mcp get typora

The committed .mcp.json is a project-scoped Claude Code configuration. It
starts the built dist/src/index.js from the local checkout root.

## Install or update the bridge

Installing the MCP server does not change Typora. First ask the MCP client:

    Check Typora bridge status. If it is not installed, install it.

The explicit typora_install_bridge tool backs up window.html once, adds a
marker-scoped deferred script loader, writes typora-mcp-bridge.js, and requires
a normal Typora restart. typora_uninstall_bridge removes only this project's
marker block and bridge script.

## First prompt

    Check Typora status, then explain whether the standalone bridge is installed,
    connected, and safe to use for the current document.

## Tool overview

| Category | Tools | Purpose |
| --- | --- | --- |
| Discovery | typora_status, typora_capabilities, typora_bridge_status | Find Typora, targets, bridge state, and supported operations. |
| Bridge lifecycle | typora_install_bridge, typora_uninstall_bridge | Explicit marker-scoped bridge management. |
| Inspection | typora_snapshot, get_dom, query_selector, get_element, typora_get_document_source | Inspect renderer state, DOM, styles, and source hashes. |
| Safe actions | click, type, press_key, scroll | Operate DOM controls; type rejects the editor body. |
| Lifecycle | typora_launch, typora_close, typora_restart, typora_open_document | Manage MCP-owned Typora instances. |
| Fixtures | typora_run_fixture | Run read-only JSON fixtures and write separate evidence. |
| Flight Recorder | typora_diagnostic_start, typora_diagnostic_status, typora_diagnostic_finish, typora_diagnostic_report, typora_diagnostic_cleanup | Record a local redacted timeline and retain compressed diagnostic archives. |
| Debug evidence | get_console_logs, get_javascript_errors, get_network_requests | Read cursor-based events. |
| Debug capture | typora_enable_debug_network_capture, typora_disable_debug_network_capture | Temporarily capture fetch/XHR traffic. |

Optional capabilities are declared by typora_capabilities. Standalone mode does
not provide screenshots or external CDP. execute_javascript appears only when
Debug Mode and its separate token are configured.

## Fixtures and evidence

Fixtures live below TYPORA_MCP_FIXTURE_ROOT. Each default run starts an isolated
MCP-owned Typora profile. Evidence is written below
TYPORA_MCP_EVIDENCE_ROOT/runId:

- run.json
- source.json
- snapshot.json
- events.json
- assertions.json
- screenshot.png when supported and requested

    npm test
    npm run test:live

## Flight Recorder

Start a named run before reproducing a bug:

    Start a Typora diagnostic run named "menu-click-no-response".

Then ask the agent to reproduce and investigate the problem. End with:

    Finish the current Typora diagnostic run, then return its diagnostic report.

The recorder stores a local redacted timeline under
%LOCALAPPDATA%/typora-mcp/diagnostics by default. Full run directories remain
for 14 days; older runs are compressed into dated archives and retained. When
archives exceed 2 GB, MCP reports a storage warning without deleting evidence.

## Security and limits

- The bridge listens only on 127.0.0.1 and authenticates every call with a
  local token.
- Bridge installation is explicit and reversible.
- Normal mode does not expose arbitrary JavaScript evaluation.
- Network capture is off by default and restores original fetch/XHR functions.
- Fixtures cannot modify Markdown source through type.
- Diagnostic traces omit bridge tokens, Markdown bodies, input text, and
  arbitrary JavaScript expressions by default.

## Repository layout

    src/                 MCP server, bridge, fixtures, and adapters
    test/                Unit and live Typora verification
    docs/specs/          V1 product contract
    .mcp.json            Project-scoped Claude Code MCP configuration

## Contributing

Issues and pull requests are welcome. Include a focused reproduction or fixture
for behavior changes. Never commit Typora installation files, tokens, or local
evidence.

## License

[MIT](LICENSE)
