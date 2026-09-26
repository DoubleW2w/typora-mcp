# Typora MCP Server

让 Codex 或 ChatGPT Desktop 直接启动、观察、操作和调试 Typora。服务通过 STDIO 提供 MCP 工具，通过 Chrome DevTools Protocol 连接 Typora renderer，不需要手动打开 Developer Tools 或复制 Console 内容。

## 能力

- 查找、启动、刷新和关闭 Windows、macOS、Linux 上的 Typora；
- 获取 DOM、元素样式、可访问性信息和事件监听器；
- 执行 JavaScript 与原始 CDP 命令；
- 增量读取 Console、JavaScript 错误和网络事件；
- 基于 DOM 点击、输入、按键、滚动并截图；
- 支持多个 Typora renderer，目标不明确时拒绝猜测；
- renderer 刷新后自动重新发现页面。

## 要求

- Node.js 20 或更高版本；
- 已安装 Typora；
- Codex 或 ChatGPT Desktop 等支持本地 STDIO MCP 的客户端。

## 安装与构建

```bash
npm install
npm run build
```

编译入口为绝对路径：

```text
<项目目录>/dist/src/index.js
```

## 配置 Codex

使用 CLI：

```bash
codex mcp add typora -- node "<项目绝对路径>/dist/src/index.js"
codex mcp list
```

或写入 `~/.codex/config.toml`：

```toml
[mcp_servers.typora]
command = "node"
args = ["<项目绝对路径>/dist/src/index.js"]
```

ChatGPT Desktop 与同一主机上的 Codex 可以共享 MCP 配置。也可以在 ChatGPT Desktop 的 **Settings → MCP servers → Add server** 中选择 STDIO，并填写相同的命令和参数。

## Typora 路径

服务按以下顺序查找 Typora：

1. `typora_launch` 的 `executablePath`；
2. `TYPORA_PATH` 环境变量；
3. 当前系统的常见安装路径；
4. `PATH` 中的 `typora`；
5. Windows 卸载注册表中的 Typora 安装位置。

需要覆盖时，在 MCP 配置中加入环境变量。例如 Codex：

```toml
[mcp_servers.typora]
command = "node"
args = ["<项目绝对路径>/dist/src/index.js"]
env = { TYPORA_PATH = "D:\\Apps\\Typora\\Typora.exe" }
```

若 Typora 已经由其他方式以 `--remote-debugging-port=9222` 启动，可设置：

```toml
env = { TYPORA_CDP_ENDPOINT = "http://127.0.0.1:9222" }
```

`typora_launch.userDataDir` 可指定隔离的 Electron 用户目录。这会允许 MCP 启动一个独立的 Typora 测试实例，而不干扰已经打开的 Typora 窗口。

## 工具

生命周期：

```text
typora_status
typora_launch
typora_close
typora_reload
```

调试与观察：

```text
get_dom
query_selector
get_element
execute_javascript
send_cdp_command
get_console_logs
get_javascript_errors
get_network_requests
clear_debug_events
take_screenshot
```

UI 操作：

```text
click
type
press_key
scroll
```

## 推荐调试流程

```text
1. typora_status
2. get_dom / query_selector / get_element
3. 记住 latestDebugSeq
4. click / type / press_key 复现问题
5. 用 afterSeq 获取 Console、错误和网络增量
6. 必要时 execute_javascript 或 send_cdp_command
7. 使用宿主 AI 的文件工具修改代码
8. typora_reload
9. 重复操作并比较结果
```

示例提示：

> 检查 Typora 当前状态。找到点击无反应的菜单，记录调试事件序号后复现问题，检查新增 Console、JavaScript 错误、网络请求、事件监听器和计算样式。修复代码后刷新 Typora，并重复同一操作验证。

## 已有 Typora 实例

Chromium 远程调试参数必须在进程启动时生效。如果 Typora 已经运行但没有 CDP：

- `typora_status` 会报告 renderer 不可连接；
- `typora_launch` 默认返回 `TYPORA_RUNNING_WITHOUT_CDP`，不会擅自关闭；
- 显式使用 `restartIfNeeded: true` 才会请求关闭并重新启动；
- 若存在未保存提示，服务返回 `TYPORA_CLOSE_PENDING`，由用户决定是否保存。

## CDP 兼容性

Typora MCP Server 需要目标 Typora 实例实际开放 Chrome DevTools Protocol。若启动后端口仍不可达，`typora_launch` 返回 `TYPORA_CDP_UNAVAILABLE`，并尝试正常关闭仅由本 MCP 启动的实例。

当前项目在本机安装的 Typora 正式版上进行了隔离实例验证：该版本保留 `--remote-debugging-port` 参数但不监听端口，并且其资源包含拒绝调试的提示。因此本项目不会尝试修改或绕过 Typora 二进制的调试保护。要使用 DOM、Console、CDP 和截图工具，需要使用实际开放 CDP 的 Typora 调试构建或受支持的官方调试接口。

## 多窗口

`typora_status` 返回每个 renderer 的 `targetId`。有且只有一个窗口获得焦点时，页面工具可以省略 `targetId`；否则必须明确传入，服务不会默认操作第一个窗口。

## 测试

不启动 Typora 的测试：

```bash
npm test
```

真实 Typora 验收：

```bash
npm run test:live
```

现场测试总是使用临时 Electron profile，创建一个临时 DOM 控件，验证 JavaScript、DOM、输入、点击、Console、截图和 reload；控件会随 reload 消失。测试结束时会请求正常关闭该隔离实例，并删除临时 profile。截图保存在 `screenshots/live.png`。

## 安全

服务默认只使用 STDIO，不监听网络端口。`execute_javascript` 和 `send_cdp_command` 拥有与 Developer Tools 相近的能力，只应在可信的本机 MCP 客户端中启用。强制关闭必须显式传入 `force: true`。
