# Typora MCP Server 设计

日期：2026-09-26

## 目标

Typora MCP Server 让 AI 直接连接、观察、操作和调试正在运行的 Typora，完成“发现问题、获取信息、修改代码、刷新 Typora、再次验证”的闭环，不再要求用户在 Developer Tools 和 AI 之间人工复制 JavaScript、DOM、Console、错误或截图。

第一版面向本机运行的 Codex 与 ChatGPT Desktop，通过 STDIO 使用同一套 MCP 工具。服务负责 Typora 生命周期和 renderer 调试；代码修改继续由宿主 AI 的文件工具完成。

## 成功标准

- Codex 与 ChatGPT Desktop 使用相同的 STDIO MCP 配置。
- 服务可在 Windows、macOS 和 Linux 查找、启动、观察、刷新和关闭 Typora。
- AI 可读取 DOM、元素详情、Console、JavaScript 错误、网络请求和截图。
- AI 可执行 JavaScript、原始 CDP 命令，以及基于 DOM 的点击、输入、按键和滚动。
- renderer 刷新或重建后，服务能够恢复连接。
- 无需用户打开 Developer Tools 或手动转发调试信息。

## 非目标

第一版不实现：

- Streamable HTTP；
- 坐标点击或操作系统 UI Automation；
- 通用文件读写；
- 云端中继或多机器控制；
- 针对 Typora 私有内部 API 的大规模版本适配层。

## 架构

```text
ChatGPT Desktop / Codex
          │ STDIO MCP
          ▼
┌─────────────────────────────┐
│ Typora MCP Server           │
│                             │
│  Lifecycle  启动、关闭、状态 │
│  Session    CDP连接与重连    │
│  Observer   日志/错误/网络    │
│  Tools      DOM与UI操作       │
└──────────────┬──────────────┘
               │ CDP
               ▼
        Typora Renderer
```

实现使用 Node.js 20+、TypeScript、`@modelcontextprotocol/sdk`、`zod` 与 `playwright-core`。`playwright-core` 只连接 Typora 暴露的 CDP 端点，不下载或启动额外浏览器。

内部只有四项职责：

1. Lifecycle：跨平台发现、启动和关闭 Typora。
2. Session：连接 CDP、选择 renderer，并在 renderer 重建后恢复连接。
3. Observer：持续收集 Console、JavaScript 错误和网络事件。
4. Tools：把共享会话暴露为 MCP 工具。

平台差异由普通函数和 `process.platform` 处理，不建立平台类层级。

## Typora 生命周期

### 可执行文件发现

发现顺序如下：

1. `typora_launch.executablePath`；
2. `TYPORA_PATH` 环境变量；
3. 当前平台的常见安装路径；
4. `PATH` 中的 `typora` 命令。

找不到时返回 `TYPORA_NOT_FOUND`，并列出检查过的候选位置。

### 启动

`typora_launch` 使用参数数组启动进程，不经过 shell。服务选择一个可用本地端口，并将远程调试参数传给 Typora。启动完成的定义是 CDP 端点可达且至少发现一个可用 renderer，而不仅是进程已经创建。

如果已经存在未启用 CDP 的 Typora 实例，默认返回 `TYPORA_RUNNING_WITHOUT_CDP`，不擅自关闭。只有显式传入 `restartIfNeeded: true` 时，服务才请求正常退出后重新启动。

### 关闭

`typora_close` 默认请求正常关闭并允许 Typora 显示未保存提示。若窗口仍存在，工具返回当前状态，不绕过提示。只有显式传入 `force: true` 时才终止进程；强制关闭只作用于已确认的 Typora PID。

## Renderer 与多窗口

`typora_status` 返回全部 renderer 及当前选择：

```json
{
  "targets": [
    {
      "targetId": "target-id",
      "title": "note.md - Typora",
      "url": "file:///...",
      "focused": true
    }
  ],
  "activeTargetId": "target-id"
}
```

默认选择 `document.hasFocus()` 为真的 renderer。若多个 renderer 同时声称焦点，或没有任何 renderer 可明确选择，需要调用方传入 `targetId`。所有页面相关工具都接受可选的 `targetId`，服务不会静默猜测窗口。

当前文件路径可能来自启动参数、renderer 状态或窗口信息。结果必须同时给出 `source` 和 `confidence`；无法可靠确定时返回 `null`。

## MCP 工具

### 生命周期

```text
typora_status()

typora_launch({
  executablePath?,
  filePath?,
  debugPort?,
  extraArgs?,
  restartIfNeeded?: false
})

typora_close({ force?: false })
typora_reload({ targetId?, ignoreCache?: false })
```

`typora_status` 返回进程、PID、进程归属、窗口、当前文件、CDP、renderer 和最新调试事件序号。

### DOM 与 Developer Tools

```text
get_dom({
  targetId?,
  selector?: "html",
  format?: "html" | "text" | "accessibility",
  maxChars?: 50000
})

query_selector({
  targetId?,
  selector,
  limit?: 50
})

get_element({
  targetId?,
  selector,
  index?,
  includeStyles?: true,
  includeListeners?: true,
  includeAccessibility?: true
})

execute_javascript({
  targetId?,
  expression,
  awaitPromise?: true,
  timeoutMs?: 10000
})

send_cdp_command({
  targetId?,
  method,
  params?: {}
})
```

`query_selector` 返回标签、文本、属性、可见性和元素矩形。后续工具使用 `selector + index`，不保存跨调用的 DOM 句柄。`get_element` 返回请求的计算样式、可访问性信息和通过 CDP 获得的事件监听器。

JavaScript 和 CDP 结果优先按值序列化；循环引用、DOM 节点或超大对象返回有限预览，并标记是否截断。

### 调试事件

```text
get_console_logs({ targetId?, afterSeq?, levels?, limit? })
get_javascript_errors({ targetId?, afterSeq?, limit? })
get_network_requests({
  targetId?,
  afterSeq?,
  urlPattern?,
  limit?,
  includeBodies?: false,
  maxBodyChars?: 20000
})
clear_debug_events({ targetId? })
```

Observer 从 CDP 连接成功后开始记录：

- Console 参数与调用位置；
- 未捕获异常和未处理的 Promise rejection；
- 请求、响应、状态码、失败原因与耗时；
- 显式请求且有限长度的请求或响应正文。

全部事件使用统一递增 `seq`。AI 可以在操作前记录序号，操作后通过 `afterSeq` 只读取新增事件。事件保存在有限大小的环形缓冲区；溢出时结果包含最早仍可用的序号。

### UI 操作与截图

```text
click({ targetId?, selector, index? })
type({ targetId?, selector, text, index?, clear?: true })
press_key({ targetId?, key, selector?, index? })
scroll({ targetId?, selector?, deltaX?: 0, deltaY })
take_screenshot({ targetId?, selector?, fullPage?: false })
```

UI 操作通过 DOM 和 CDP 完成。操作前等待元素可见且可交互。selector 匹配多个元素时返回 `SELECTOR_AMBIGUOUS`；调用方必须通过 `index` 明确选择。截图直接返回 MCP 图片内容。

## 返回与错误模型

工具返回简短文本和结构化数据：

```json
{
  "ok": true,
  "sessionId": "typora-1",
  "data": {},
  "warnings": []
}
```

稳定错误码包括：

```text
TYPORA_NOT_FOUND
TYPORA_RUNNING_WITHOUT_CDP
CDP_UNREACHABLE
RENDERER_NOT_FOUND
TARGET_AMBIGUOUS
SELECTOR_NOT_FOUND
SELECTOR_AMBIGUOUS
JAVASCRIPT_TIMEOUT
```

输入错误使用 MCP 工具错误返回；运行状态错误在结构化结果中携带错误码和可执行的恢复建议。输出达到限制时优先返回截断内容和 `truncated: true`，不把可用结果整体丢弃。

## 恢复行为

- renderer 刷新或重建后，Session 重新枚举目标并重新绑定 Observer。
- CDP 短暂断开时自动重连一次；再次失败则返回明确错误。
- Typora 退出后清理页面引用，但保留最后一批调试事件，供 AI 分析退出前状态。
- 所有 DOM、日志、网络正文和 JavaScript 结果都有大小上限。

## 安全边界

服务默认仅运行 STDIO，不监听网络端口。`execute_javascript` 与 `send_cdp_command` 被视为本地受信调试能力，不进行功能削弱，但工具描述会明确其任意代码执行能力。

服务不会通过 shell 拼接用户输入。强制关闭、任意 JavaScript 和原始 CDP 命令使用相应 MCP 工具注解，帮助客户端应用确认策略。服务不提供任意文件读写。

## 代码结构

```text
typora-mcp-server/
├─ src/
│  ├─ index.ts
│  ├─ server.ts
│  ├─ typora-process.ts
│  ├─ typora-session.ts
│  ├─ debug-events.ts
│  └─ tools.ts
├─ test/
│  ├─ core.test.ts
│  └─ live.test.ts
├─ package.json
├─ tsconfig.json
└─ README.md
```

`index.ts` 是 STDIO 入口，`server.ts` 注册 MCP 工具。其余文件分别处理进程、CDP 会话、调试事件和工具实现。不加入依赖注入框架、平台类层级或预留扩展系统。

## 测试

普通测试使用 Node 内置 `node:test`，不要求安装 Typora，覆盖：

- 三平台可执行文件候选路径；
- 启动参数生成；
- 端口选择；
- renderer 选择；
- 事件序号和环形缓冲；
- 工具参数校验；
- STDIO MCP 初始化与 `tools/list`。

显式运行的真实环境测试依次验证：

1. 启动 Typora；
2. 连接 renderer；
3. 获取状态和 DOM；
4. 执行 `1 + 1`；
5. 生成并读取 Console、错误和网络事件；
6. 完成点击、输入与截图；
7. reload 后恢复连接；
8. 正常关闭 Typora。

普通测试命令为 `npm test`，真实环境测试命令为 `npm run test:live`。

## 调试闭环

一个典型问题的完整流程如下：

1. 调用 `typora_status` 确认进程、renderer 和当前文件。
2. 使用 `get_dom`、`query_selector` 与 `get_element` 定位问题元素。
3. 记录最新事件序号。
4. 使用 `click` 或其他 UI 工具复现问题。
5. 用 `afterSeq` 读取新增 Console、错误和网络事件。
6. 必要时通过 `execute_javascript` 或 `send_cdp_command` 深入检查运行状态。
7. AI 使用宿主文件工具修改对应代码。
8. 调用 `typora_reload`。
9. 重复相同操作并比较 DOM、事件和截图，判断问题是否修复。
