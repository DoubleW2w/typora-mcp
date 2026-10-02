# Typora MCP Context

This context defines the domain language for the independent Typora MCP and its optional integrations with Typora plugin systems.

## Bridge and Runtime

**Typora Host**:
The running Typora application instance that owns one or more renderer windows.
_Avoid_: Typora server, browser instance.

**Renderer Bridge**:
A machine-readable control surface running inside a Typora renderer and exposing DOM, editor, plugin, event, and test state to the MCP.
_Avoid_: DevTools UI, screen automation.

**Standalone Bridge**:
The Renderer Bridge installed and managed by Typora MCP itself, independent of `typora_plugin`.
_Avoid_: built-in bridge, remote_control bridge.

**RemoteControl Adapter**:
An optional MCP backend that speaks the existing `typora_plugin` `remote_control` JSON-RPC protocol.
_Avoid_: MCP bridge, Typora CDP.

**Runtime Debugging**:
Observing and manipulating a running Typora renderer without changing the plugin repository's source files.
_Avoid_: source editing, binary patching.

**MCP-owned Typora**:
A Typora Host process launched by this MCP server and therefore eligible for MCP-managed close or restart.
_Avoid_: current Typora, active Typora.

**Capability**:
A target-specific operation that the selected backend explicitly declares safe and available.
_Avoid_: assumed feature, backend parity.

## Test and Document State

**Fixture**:
A declarative description of a reproducible Typora test flow, including the document to open, waits, actions, and assertions.
_Avoid_: test script, automation macro.

**Fixture Run**:
One isolated execution of a Fixture that produces assertions and evidence without modifying its Source Document.
_Avoid_: manual QA, source mutation.

**Source Document**:
The Markdown bytes read from the filesystem and treated as the source of truth for source-integrity checks.
_Avoid_: rendered document, editor content.

**Renderer Snapshot**:
A structured, point-in-time representation of a renderer's DOM, semantic nodes, geometry, editor state, plugin state, and debug events.
_Avoid_: screenshot, page image.

**Element Ref**:
A short-lived identifier for an element in one Renderer Snapshot; it becomes invalid after a state-changing action or snapshot revision.
_Avoid_: permanent DOM handle, coordinate.
