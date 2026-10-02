# Typora MCP V1 Product Contract

## Purpose

Typora MCP lets a local AI agent complete a reliable Typora/plugin debugging loop:
observe a running renderer, reproduce an interaction, collect machine-readable
evidence, let the host AI edit repository files, then verify the result. It is
one STDIO MCP server shared by Codex and ChatGPT Desktop.

The primary transport is the MCP-managed Standalone Bridge. RemoteControl is an
optional compatibility adapter. CDP is an optional capability, never a
requirement for Typora.

## Boundaries

- The host AI owns source-file edits. Typora MCP never patches Markdown or
  plugin source files.
- The bridge may read only the current saved Source Document. It does not offer
  arbitrary host-file reads.
- Typora resource installation is the only automatic host-resource mutation. It
  is explicit, idempotent, reversible by marker removal, and never happens at
  normal launch.
- Coordinate automation and Developer Tools UI automation are out of scope.
- Screenshots are optional evidence, not the interaction surface.

## Bridge Installation and Transport

typora_install_bridge finds Typora, creates a first-install backup of
window.html, inserts one marker-delimited script reference, writes the bridge
script, and returns restartRequired. Its status reports installation state,
bridge version, and installed content hash.

typora_uninstall_bridge removes only the MCP marker block and bridge script. It
never restores the whole backup automatically, because that could overwrite
legitimate later changes made by the user or typora_plugin. The retained backup
is manual disaster recovery only.

Each renderer owns one loopback HTTP JSON-RPC listener on a dynamic port and one
registry file:

    <registryRoot>/targets/<targetId>.json

The file contains bridge version, targetId, pid, endpoint, creation time, and
an authentication token. It is local-user data; tools never expose the token.
MCP accepts only loopback endpoints, validates authentication by a status
probe, and ignores stale records. It does not delete registry records merely
because a probe fails.

## Capability and Target Selection

typora_capabilities is a required read-only discovery tool. It reports each
target's supported operations, including snapshot, sourceRead, resourceTiming,
debugNetworkCapture, screenshot, debugEval, safeRestart, RemoteControl, and
CDP.

A target is active only when exactly one connected renderer reports
document.hasFocus(). If no target is uniquely focused, an operation may omit
targetId only when exactly one live target exists. Every other ambiguous action
fails instead of selecting a recent or first target.

## Snapshot Contract

typora_snapshot returns bounded semantic state, not full HTML by default:

    {
      snapshotId,
      revision,
      targetId,
      document: { path, sourceHash, rendererHash },
      editor: { mode, selection, cursor },
      nodes: [{ ref, role, tag, text, attributes, visible, box, styles }],
      plugins,
      events: { latestSeq }
    }

Snapshots accept rootSelector, maxNodes, and maxTextChars. A node ref belongs
to one snapshot only. Any state-changing action invalidates the target's
previous revision; refs expire after two minutes even without an action.
Actions accept either snapshotId plus ref, or an explicit CSS selector. An
ambiguous selector is an error. No separate typora_find tool is needed in V1;
scoped snapshots and query_selector cover that use case.

## Source Protection and UI Actions

The Source Document is the saved Markdown file opened by Typora. Fixture and
normal debugging flows compare sourceHash before and after a run by default.

click, press_key, and scroll may operate on renderer UI. type may operate on
dialog, menu, search, and preferences controls, but must reject targets inside
the editor body such as #write. Markdown modifications are made only by the
host AI's ordinary file tools.

## Lifecycle

typora_launch starts an MCP-owned Typora instance and may pass a document path.
typora_close and typora_restart may automatically affect only MCP-owned
instances. Externally launched Typora instances are observable, but never
closed or restarted automatically.

typora_open_document is a convenience action for an existing target. A fixture
run is stricter: it starts an MCP-owned Typora process with Typora.exe followed
by the fixture Markdown path, waits for the expected document path and ready
state, then begins assertions. Standalone does not call location.reload;
typora_restart is the safe replacement for an MCP-owned instance.

## Debug Evidence

Every target exposes bounded, sequence-numbered console, JavaScript error, and
unhandled-rejection streams. Results include afterSeq, oldestAvailableSeq,
latestSeq, and truncated.

The normal network capability is resource timing only. It reports completed
browser resources and explicitly identifies itself as resourceTiming.
debugNetworkCapture is opt-in per target and temporarily instruments fetch and
XMLHttpRequest to report request, response, and failure events. Neither
capability promises Electron IPC, WebSocket, or universal internal-network
coverage.

Normal mode does not register execute_javascript. Debug Mode is an explicit MCP
startup setting; only then is execute_javascript registered, and every call requires a
separate debug token. The debug token is not the bridge transport token.

## Fixtures and Evidence

Fixtures are declarative JSON inputs from configured read-only fixture roots.
They declare a document, waits, allowed UI actions, assertions, and optional
evidence requests. V1 supports waits for renderer readiness, selector/text
presence, and event sequence progress; assertions cover source integrity,
snapshot nodes, attributes, computed styles, and captured events.

Each run creates a separate evidence directory:

    <evidenceRoot>/<runId>/

It contains run metadata, source hashes, snapshots, event slices, assertion
results, and optional screenshots. Fixture execution defaults to an MCP-owned
test target. A caller must explicitly provide targetId and allowSharedTarget
to use an existing window; that mode never closes or restarts the window.

## Backend Compatibility

Standalone is selected first in auto mode, then RemoteControl, then an
available CDP backend. Backends do not promise identical capabilities; agents
must inspect typora_capabilities before an operation. RemoteControl source is
never changed by this project.

## V1 Acceptance Criteria

- Installer is idempotent, detects version/hash mismatch, and marker-only
  removal preserves unrelated window.html modifications.
- Two renderer windows register independently; stale registry records never
  cause an action to target the wrong window.
- Snapshot refs reject after state change or expiry; ambiguous selectors reject.
- A fixture opens an existing Markdown input in an MCP-owned Typora instance,
  produces separate evidence, and proves sourceHash is unchanged.
- Normal mode cannot modify editor Markdown through type or invoke eval.
- Opt-in debug network capture and Debug Mode declare their capability and
  limitations before use.
