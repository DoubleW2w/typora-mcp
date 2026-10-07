# Typora MCP

[English](README.md) | [简体中文](README.zh-CN.md)

![MIT License](https://img.shields.io/badge/license-MIT-6C47FF.svg?style=flat-square)
![Node.js 20+](https://img.shields.io/badge/node-%3E%3D20-339933.svg?style=flat-square)
![MCP](https://img.shields.io/badge/MCP-STDIO-6C47FF.svg?style=flat-square)

一个本地优先的 MCP 服务器：通过显式安装的 renderer bridge，对正在运行的 Typora 进行检查、调试与安全自动化。

> [!WARNING]
> 这是独立社区项目，不隶属于 Typora、Anthropic 或 OpenAI。

## 核心能力

- 为 Codex 与 Claude Code 提供同一套本地 MCP 工具。
- 使用可逆 bridge 获取 DOM、样式、源码 hash、日志与 fixture 证据。
- 使用结构化 snapshot 和短生命周期 element ref，不依赖屏幕坐标。
- 使用隔离 Typora profile 运行 fixture，并验证 Markdown 源码没有被改写。

## 环境要求

- Node.js 20 或更高版本。
- 已安装 Typora。
- 只有显式安装 bridge 时才需要 Typora resources 的写入权限。

## 从源码安装

    git clone https://github.com/DoubleW2w/typora-mcp.git
    cd typora-mcp
    npm install
    npm run build

项目当前不发布 npm 包，MCP 客户端直接启动本地构建产物。

## 连接 Codex

    codex mcp add typora -- node "<typora-mcp 绝对路径>/dist/src/index.js"
    codex mcp list

也可写入 Codex 配置：

    [mcp_servers.typora]
    command = "node"
    args = ["<typora-mcp 绝对路径>/dist/src/index.js"]
    cwd = "<typora-mcp 绝对路径>"

    [mcp_servers.typora.env]
    TYPORA_PATH = "D:\\Typora\\Typora.exe"
    TYPORA_BACKEND = "standalone"

## 插件分发状态

当前源码版本支持 Codex 与 Claude Code 的官方 MCP 配置格式，但尚不是远程一键
插件。marketplace 缓存副本不包含本项目的 Node 依赖，因此应先按上述方式 clone、
安装依赖、构建，再直接配置本地 STDIO server。

后续在 npm 包或包含运行时依赖的 GitHub Release bundle 发布后，才提供远程
Codex/Claude 一键插件安装。

## 连接 Claude Code

在本地 clone 的仓库中执行：

    claude mcp add typora -- node "<typora-mcp 绝对路径>/dist/src/index.js"
    claude mcp get typora

仓库中的 .mcp.json 是项目级 Claude Code 配置；它从本地 checkout 根目录启动已构建的 dist/src/index.js。

## 安装或更新 bridge

安装 MCP server 本身不会修改 Typora。先让 MCP 客户端执行：

    检查 Typora bridge 状态；若未安装，则安装 bridge。

typora_install_bridge 会备份一次 window.html、添加带 marker 的延迟加载脚本、写入 typora-mcp-bridge.js，并要求正常重启 Typora。typora_uninstall_bridge 仅删除本项目的 marker 和 bridge 脚本。

## 第一个提示词

    检查 Typora 状态，并说明 standalone bridge 是否已安装、已连接，以及当前文档能否安全调试。

## 工具概览

| 分类 | 工具 | 用途 |
| --- | --- | --- |
| 发现 | typora_status、typora_capabilities、typora_bridge_status | 发现 Typora、target、bridge 状态和能力。 |
| Bridge 生命周期 | typora_install_bridge、typora_uninstall_bridge | 显式管理 marker-scoped bridge。 |
| 检查 | typora_snapshot、get_dom、query_selector、get_element、typora_get_document_source | 检查 renderer、DOM、样式和源码 hash。 |
| 安全 UI 操作 | click、type、press_key、scroll | 操作 DOM 控件；type 会拒绝正文编辑区。 |
| Typora 生命周期 | typora_launch、typora_close、typora_restart、typora_open_document | 管理由 MCP 启动的 Typora。 |
| Fixture | typora_run_fixture | 运行只读 JSON fixture，写入独立证据。 |
| Flight Recorder | typora_diagnostic_start、typora_diagnostic_status、typora_diagnostic_finish、typora_diagnostic_report、typora_diagnostic_cleanup | 记录本地脱敏 timeline，并长期保留压缩诊断档案。 |
| 调试证据 | get_console_logs、get_javascript_errors、get_network_requests | 读取带 cursor 的事件。 |
| 网络捕获 | typora_enable_debug_network_capture、typora_disable_debug_network_capture | 临时捕获 fetch/XHR。 |

可选能力由 typora_capabilities 声明。Standalone 不支持截图或外部 CDP；execute_javascript 仅在配置 Debug Mode 和独立 token 后出现。

## Fixture 与证据

Fixture 位于 TYPORA_MCP_FIXTURE_ROOT 下。默认运行会启动隔离、由 MCP 拥有的 Typora profile。证据写入 TYPORA_MCP_EVIDENCE_ROOT/runId：

- run.json
- source.json
- snapshot.json
- events.json
- assertions.json
- 目标支持且 fixture 请求时的 screenshot.png

    npm test
    npm run test:live

## Flight Recorder

复现问题前，先启动一个命名诊断 run：

    启动一个名为 "menu-click-no-response" 的 Typora 诊断记录。

再让 AI 复现并排查问题。结束时要求：

    结束当前 Typora 诊断 run，再返回 diagnostic report。

默认记录到：

    %LOCALAPPDATA%/typora-mcp/diagnostics

完整 run 目录保留 14 天；超期后压缩到按月份归档的本地 archive 中并继续保留。
archive 超过 2 GB 时 MCP 只发出 storage warning，不会自动删除证据。

## 安全与限制

- bridge 仅监听 127.0.0.1，每次调用均需本地 token。
- 安装 bridge 是显式、可逆操作。
- 普通模式不开放任意 JavaScript 执行。
- 网络捕获默认关闭，结束后恢复原始 fetch/XHR。
- fixture 不能通过 type 改写 Markdown 源码。
- 默认 diagnostic trace 不保存 bridge token、Markdown 正文、输入文本或任意 JavaScript expression。

## 贡献

欢迎 Issue 与 Pull Request。行为变更请附带复现或 fixture；不要提交 Typora 安装文件、token 或本地 evidence。

## 许可证

[MIT](LICENSE)
