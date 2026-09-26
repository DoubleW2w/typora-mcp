# Typora MCP Server 实施计划

设计依据：`docs/superpowers/specs/2026-09-26-typora-mcp-server-design.md`

目标：交付一个跨平台、STDIO 传输的 Typora MCP Server，通过 CDP 管理和调试 Typora renderer。

原则：每一步只实现当前测试要求的最小代码；使用 Node 内置测试，不引入额外框架或抽象层。

## 任务 1：建立可运行的 TypeScript MCP 项目

文件：

- 新建 `package.json`
- 新建 `tsconfig.json`
- 新建 `src/index.ts`
- 新建 `src/server.ts`
- 新建 `test/server.test.ts`

步骤：

1. 写一个测试，通过 SDK 客户端启动编译后的 STDIO 服务并调用 `tools/list`。
2. 运行测试，确认因项目尚未建立而失败。
3. 添加最小 npm 脚本、TypeScript 配置和空的 `McpServer`。
4. 注册临时的 `typora_status` 工具，使 `tools/list` 能确认服务名称和工具名称。
5. 运行 `npm run build` 与 `npm test`。

验证：服务只向 stdout 写 MCP 协议；诊断信息只能写 stderr。

提交：`chore: scaffold stdio MCP server`

## 任务 2：实现事件缓冲区

文件：

- 新建 `src/debug-events.ts`
- 新建 `test/debug-events.test.ts`

步骤：

1. 测试递增序号、`afterSeq` 过滤、类型过滤和容量淘汰。
2. 实现一个固定容量的普通类，保存 Console、JavaScript 错误和网络事件。
3. 测试清空后序号继续递增，避免旧 cursor 与新事件混淆。
4. 运行 `npm test`。

验证：达到容量时只淘汰最旧事件，并返回 `oldestAvailableSeq` 与 `latestSeq`。

提交：`feat: add bounded debug event buffer`

## 任务 3：实现跨平台 Typora 进程管理

文件：

- 新建 `src/typora-process.ts`
- 新建 `test/typora-process.test.ts`

步骤：

1. 测试 Windows、macOS、Linux 的候选路径顺序。
2. 测试显式路径、`TYPORA_PATH` 和平台候选路径的优先级。
3. 测试远程调试启动参数和可选文件路径的参数数组。
4. 实现路径发现、空闲端口选择、无 shell 的进程启动和受限 PID 关闭。
5. 测试正常关闭与 `force` 分支只针对已确认的 Typora 进程。
6. 运行 `npm test`。

验证：所有用户值均作为独立参数传给 `spawn`，不拼接 shell 命令。

提交：`feat: manage Typora process lifecycle`

## 任务 4：实现 CDP 会话与 renderer 选择

文件：

- 新建 `src/typora-session.ts`
- 新建 `test/typora-session.test.ts`

步骤：

1. 用简单的 Page 替身测试 focused renderer 选择、无焦点、多焦点和显式 `targetId`。
2. 实现 `playwright-core` 的 `connectOverCDP` 连接。
3. 枚举默认 context 的页面并为每个页面生成稳定的会话内 `targetId`。
4. 实现页面关闭、重载和 renderer 重建后的重新枚举。
5. 实现一次有限重连，不加入后台重试框架。
6. 运行 `npm test`。

验证：目标不明确时返回 `TARGET_AMBIGUOUS`，不默认选择第一个窗口。

提交：`feat: connect to Typora renderer over CDP`

## 任务 5：绑定 Console、错误和网络观察

文件：

- 修改 `src/typora-session.ts`
- 修改 `src/debug-events.ts`
- 新建 `test/observer.test.ts`

步骤：

1. 测试 Playwright 事件被转换成稳定、可序列化的事件结构。
2. 在页面绑定 `console`、`pageerror`、`request`、`response` 与 `requestfailed`。
3. 记录请求开始时间，并在响应或失败时计算耗时。
4. 限制参数预览和正文长度；正文仅在明确请求时读取。
5. 确保 renderer 重建时不会重复绑定同一个页面。
6. 运行 `npm test`。

验证：一次页面事件只产生一条相应记录，所有记录共享递增 `seq`。

提交：`feat: capture Typora debug events`

## 任务 6：实现 DOM、JavaScript、CDP 和 UI 操作

文件：

- 新建 `src/tools.ts`
- 新建 `test/tools.test.ts`

步骤：

1. 测试 selector 为零、一、多个匹配时的行为。
2. 实现 `get_dom`、`query_selector` 和 `get_element`。
3. 使用 CDP 获取事件监听器；无法获取的单项信息作为 warning 返回，不让整个元素查询失败。
4. 实现 `execute_javascript` 与 `send_cdp_command`，并限制可序列化结果大小。
5. 实现 `click`、`type`、`press_key`、`scroll` 与 `take_screenshot`。
6. 实现 `typora_reload`、日志读取和 `clear_debug_events`。
7. 运行 `npm test`。

验证：多匹配时必须显式传 `index`；截图返回 MCP 图片内容；所有文本输出包含截断标记。

提交：`feat: expose Typora debugging operations`

## 任务 7：注册最终 MCP 工具和错误模型

文件：

- 修改 `src/server.ts`
- 修改 `src/index.ts`
- 修改 `test/server.test.ts`

步骤：

1. 为设计文档中的全部工具编写 Zod 输入 schema。
2. 把生命周期、Session、Observer 和工具函数连接到同一个服务实例。
3. 添加统一成功结果和稳定运行错误码。
4. 添加 MCP 工具注解，区分只读工具、交互工具和破坏性工具。
5. 更新 `tools/list` 测试，核对完整工具名称集合。
6. 添加一个模拟会话的调用测试，验证结构化结果和错误结果。
7. 运行 `npm run build` 与 `npm test`。

验证：工具描述足以让 AI 选择正确顺序，且不依赖 README 才能理解关键参数。

提交：`feat: register Typora MCP tools`

## 任务 8：真实环境验收与使用文档

文件：

- 新建 `test/live.test.ts`
- 新建 `README.md`
- 新建 `.gitignore`

步骤：

1. 编写仅在 `TYPORA_LIVE_TEST=1` 时运行的真实 Typora 测试。
2. 覆盖启动、状态、DOM、JavaScript、事件、截图、重载与正常关闭。
3. 在 README 中记录安装、构建和三平台的 Typora 路径覆盖方式。
4. 添加 Codex 与 ChatGPT Desktop 的同一份 STDIO 配置示例。
5. 记录已有 Typora 未启用 CDP、未保存提示和多窗口歧义的恢复方式。
6. 运行 `npm run build`、`npm test`；具备 Typora 环境时运行 `npm run test:live`。

验证：从全新安装说明出发，客户端能够列出工具并完成一次真实调试闭环。

提交：`docs: add setup and live verification`

## 最终检查

1. `npm run build`
2. `npm test`
3. `npm run test:live`，若机器未安装 Typora则明确记录未运行原因
4. `git status --short`
5. 对照设计文档核查工具名称、错误码和非目标

