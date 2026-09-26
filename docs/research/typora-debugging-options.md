# Typora debugging options (primary-source research)

Research date: 2026-09-26

## Executive conclusion

Typora documents an in-app renderer debugging path: open Chromium/WebKit DevTools from Typora’s menus/shortcut. It also documents passing selected Chrome/Electron switches at launch and through the advanced `flags` setting. Typora does **not** document an official “debug build” channel, a Typora-specific CDP/automation API, or a supported external bridge API. The Electron `--remote-debugging-port` switch is real, but using it against Typora is an inference from Electron behavior, not a Typora-supported integration contract.

## What Typora officially supports

### Renderer DevTools

Typora’s own CSS guide says to use Chrome/Safari DevTools. On Windows/Linux, the documented action is `View → Toggle DevTools`; on macOS, enable debug from `Help → Enable Debug`, then use `Inspect Elements` from the editor context menu. The Typora shortcut reference lists `Shift + F12` for Toggle DevTools on Windows/Linux. This is the clearest supported way to inspect the renderer DOM, styles, console, and network/runtime state.

- [Add Custom CSS — Typora Support](https://support.typora.io/Add-Custom-CSS/)
- [Shortcut Keys — Typora Support](https://support.typora.io/Shortcut-Keys/)
- [Write Custom Theme for Typora — Typora Theme Gallery](https://theme.typora.io/doc/Write-Custom-Theme/)

### Logs

Typora’s support page documents `typora.log` at `%APPDATA%\\Typora` on Windows and in the theme-folder parent on Linux. macOS users are directed to Console.app and system log collection. This is an official diagnostic path, but it is file/log collection rather than an interactive debugger or API.

- [Get Typora Logs — Typora Support](https://support.typora.io/Get-Logs/)

### Launch flags

Typora’s Windows/Linux launch-arguments page explicitly permits extra arguments and lists Chrome-based switches such as `--disable-gpu`, `--proxy-server`, `--host-rules`, and `--no-sandbox`. It links to Electron’s command-line-switch documentation and says the same class of flags can be placed in the advanced configuration’s `flags` property. The advanced-settings page confirms that `flags` stores arguments passed when Typora launches.

- [Launch Arguments (Windows/Linux) — Typora Support](https://support.typora.io/Launch-Arguments/)
- [Advanced Settings File (Windows/Linux) — Typora Support](https://support.typora.io/Advance-Config/)

## CDP / remote debugging assessment

Electron’s official switch reference documents `--remote-debugging-port=<port>` as enabling remote debugging over HTTP. It separately documents `--enable-logging[=file]`, with file logging being the reliable option for Windows child processes. Therefore, a local experiment may be reasonable:

```text
Typora.exe --remote-debugging-port=9222 --enable-logging=file
```

However, Typora’s launch-arguments page does not list `--remote-debugging-port`; it only points users to Electron’s generic switch list. There is no Typora document promising that this switch is accepted by every release, that the port is exposed by the packaged app, or that a stable CDP target/API is maintained. Treat CDP access as an Electron/Chromium compatibility experiment, not as a supported Typora API. Do not assume the port is safe to expose beyond loopback.

- [Supported Command Line Switches — Electron](https://www.electronjs.org/docs/latest/api/command-line-switches)
- [Debugging the Main Process — Electron](https://www.electronjs.org/docs/latest/tutorial/debugging-main-process)
- [Launch Arguments (Windows/Linux) — Typora Support](https://support.typora.io/Launch-Arguments/)

The Electron page also documents Node inspector flags (`--inspect`, `--inspect-brk`, etc.). Electron’s main-process debugging guide clarifies that browser-window DevTools debug renderer JavaScript only; main-process JavaScript needs an external debugger and `--inspect`/`--inspect-brk`. Those flags are not evidence that Typora’s packaged main process exposes a supported Node inspector endpoint. Typora does not publish its application source or a supported main-process debugging workflow.

## Official debug builds / release channels

Typora publishes stable and dev/beta release history pages, including downloadable dev builds. The pages describe release channels and changelogs; they do not identify a separately supported debug/developer build, symbols package, source build, or debug-only command-line mode. “Dev/beta” should therefore not be conflated with a debug build.

- [Typora release history](https://typora.io/releases/all)
- [Typora dev release channel](https://typora.io/releases/dev)

## Plugin and bridge APIs

Typora’s official GitHub organization lists public support/theme/i18n/tooling repositories, but not an official general-purpose plugin SDK or external bridge API. Its issue tracker contains a historical proposal to publish a plugin architecture; that issue is a proposal/discussion, not an API specification.

There are third-party plugin systems, notably [typora-community-plugin](https://github.com/typora-community-plugin/typora-community-plugin), which documents a JavaScript plugin API and installation by modifying Typora resources. It explicitly describes itself as a community plugin system and warns about third-party plugin/data risks. [obgnail/typora_plugin](https://github.com/obgnail/typora_plugin) is another community plugin project. These can be useful for experimentation, but they are unsupported by Typora and are not a stable bridge contract for production automation.

- [Typora official GitHub organization](https://github.com/typora)
- [Publish only plugin architecture — Typora issue #2915](https://github.com/typora/typora-issues/issues/2915)
- [Typora Community Plugin](https://github.com/typora-community-plugin/typora-community-plugin)
- [Community plugin development guide](https://github.com/typora-community-plugin/typora-community-plugin/blob/main/docs/en-us/dev-guide/2-plugin.md)

## Practical recommendation for this repository

1. For visual/renderer diagnosis, use Typora’s own Toggle DevTools (`Shift+F12` on Windows/Linux) and collect the official log file.
2. If external inspection is necessary, treat `--remote-debugging-port` as an optional best-effort probe. Check that the process actually exposes the local CDP endpoint before relying on it, and make the port configurable rather than assuming a fixed port.
3. Do not claim support for an official debug build or plugin/bridge API. Community plugins require resource patching and should be isolated/opt-in.

