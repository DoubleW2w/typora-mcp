# Typora MCP

## Repository contract

- The default backend order is Standalone Bridge, RemoteControl adapter, then
  CDP. Capability discovery decides what an active target may do.
- The host AI owns source-file edits. MCP UI actions must not modify Markdown
  editor content; type rejects elements inside #write.
- Fixtures are read-only inputs. Keep evidence outside fixture roots.
- Close or restart only MCP-owned Typora instances. Existing user windows are
  observable but not lifecycle-managed.

## Tight loop

    npm test

Run this after TypeScript, MCP-tool, bridge, fixture, or lifecycle changes.
Use npm run test:live only for a real Typora acceptance run; it starts an
isolated fixture profile and requires an explicitly installed bridge.

## Bridge boundaries

- Standalone bridge installation is explicit. It backs up Typora window.html,
  writes a marker-scoped deferred loader, and requires a normal Typora restart.
- Preserve other window.html injections. In particular, typora_plugin loads
  plugin/index.js before the deferred MCP bridge.
- Do not patch Typora binaries or bypass its debugging protection.
- Do not change typora_plugin source or the original remote_control plugin to
  make this project work.

## Safety

- Network capture is opt-in and temporary. Restore original fetch/XHR behavior
  after capture.
- Normal mode has no arbitrary JavaScript evaluation. Debug Mode needs its
  separate token.
- Diagnostic traces are local, redacted, and archival. Keep full runs for 14
  days, compress older runs, and warn above 2 GB rather than deleting evidence.

## Public repository

- Keep README English-first and update README.zh-CN.md with matching user-facing
  installation, tool, security, and compatibility changes.
- Keep LICENSE as MIT and maintain package repository metadata.
- GitHub marketplace plugin distribution is deferred until a release bundle or
  npm package includes runtime dependencies. Source installation remains the
  supported release path.
- Do not commit, push, create releases, or change GitHub settings without
  explicit user authorization.
