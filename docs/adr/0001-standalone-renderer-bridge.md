---
status: accepted
---

# Standalone Renderer Bridge with Optional RemoteControl Adapter

Typora MCP owns a Standalone Renderer Bridge installed through an explicit, reversible `window.html` installer; it exposes a local per-renderer JSON-RPC endpoint discovered through independent registry records. The existing `typora_plugin` `remote_control` protocol remains an optional compatibility adapter, not a required dependency. The bridge reports its target-specific capabilities instead of claiming backend parity; source-file edits remain the host AI's responsibility. This keeps the MCP usable without `typora_plugin`, preserves the working adapter, and avoids screen automation and Typora binary modification.

## Consequences

- Bridge installation and removal are explicit marker-level operations with backup and version/hash status; full-file backup restoration is manual only.
- Snapshot refs are short-lived, snapshot-scoped, and invalid after a state-changing revision.
- Fixtures are read-only inputs, run by default in an MCP-owned Typora instance, and write evidence to a separate output directory.
- Standalone never reloads the renderer; only an MCP-owned instance may be safely restarted.
- Arbitrary evaluation is disabled by default and requires explicit Debug Mode plus a separate token.
