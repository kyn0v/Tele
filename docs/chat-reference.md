# Pi 对话接口与安全边界

[English README](../README.md) | [简体中文 README](../README.zh-CN.md) | [English conversation design](chat-design.md)

## 运行归属

扩展运行在加载它的 Pi 进程内。`/tele <boardid>` 只在 Pi 空闲且没有排队消息时启动 HTTP 服务。加载扩展本身不启动服务。已有白板直接打开，不存在的白板使用教学示例初始化。

`/tele off` 立即撤销私有连接、关闭自己拥有的 HTTP 服务，然后等待 Pi 空闲，恢复连接前的工具集合。它不终止 Pi，也不撤销已经提交的白板修改。如果其他扩展的终端对话框没有结束，工具恢复可能继续等待。

Pi 的 `isIdle()` 不包含所有仍在等待的输入钩子。浏览器提交因此带有进程内 `AsyncLocalStorage` 来源标记；off 将该标记撤销。迟到的提交会在 `before_agent_start` 被中止，其工具调用也被拒绝。标记的私有全局注册器 `__audioharnessDispatchV1` 在改名后刻意保持原身份，避免实时重载丢失对旧挂起输入的撤销能力。它不是旧公共 API 的别名，不写文件或全局配置。迟到输入可能仍以已中止的记录出现在原 Pi 历史中，撤销不是删除历史。

退出、重载、切换会话、分叉和切换分支均撤销绑定。选择新会话后必须重新运行连接命令。扩展不扫描会话目录，不创建 `AgentSession`，不打开第二个会话文件写入者。数据目录仍由原来的 `BoardStore` 独占。

扩展支持 `--tele-port <0..65535>` 和 `--tele-data <path>`。端口 `0` 请求系统分配空闲端口。未指定时使用 `TELE_PORT`、`TELE_DATA` 和项目默认路径。普通 CLI 的端口配置仍要求非零端口。

`.pi/extensions/tele.js` 是项目发现入口，通过 Pi 的 TypeScript 加载器导入 `src/pi-extension.ts`。安装依赖后可在没有 `dist` 的 checkout 中加载；白板的浏览器资源仍需构建。也可以运行 `pi -e /absolute/path/Tele/.pi/extensions/tele.js` 显式加载源码入口。构建后仍支持 `pi -e /absolute/path/Tele/dist/pi-extension.js`。各入口选一个，不要在同一个 Pi 中重复加载。Pi 和 TypeBox 使用宿主包；本地开发固定 Pi 1.2.0 和 TypeBox 1.3.27，运行代码没有全局绝对导入路径。

## 私有 HTTP 协议

白板读取仍然公开给可访问本机服务的调用方。白板写入仍使用原 capability 和 `If-Match`，未改成浏览器 cookie 授权。

`GET /api/capabilities` 只返回 `chat` 布尔值。它不提供绑定、会话名、历史或配对凭据。

连接命令通过 Pi UI 通知提供一次性 URL，并在 TUI 模式尝试打开系统浏览器。秘密在 fragment 中，不在查询参数或请求路径中。浏览器模块立即擦除 fragment，再同源 POST 到 `/api/chat/pair`。命令没有向模型发送该链接，服务也不记录该链接。

配对请求包含 `binding` 和 `invitation`。有效邀请只能兑换一次，在两分钟后失效。成功响应设置随机 cookie，带有 `HttpOnly`、`SameSite=Strict` 和八小时有效期。cookie 的 Path 限于 `/api/chat/<binding>`。这里使用本机 HTTP，所以没有声称提供 TLS 或使用 `Secure` cookie。

以下接口均要求当前绑定的有效 cookie：

| 路径 | 方法 | 内容 |
| --- | --- | --- |
| `/api/chat/<binding>` | GET | 当前完整显示投影 |
| `/api/chat/<binding>/status` | GET | 同一份投影，包含状态 |
| `/api/chat/<binding>/events` | GET | `snapshot` SSE 事件 |
| `/api/chat/<binding>/command` | POST | `send` 或 `abort` |

所有 chat POST 必须包含精确匹配的 `Origin` 和 `Content-Type: application/json`。缺少 Origin 也拒绝。原有 loopback 监听、Host 校验、跨站 Fetch Metadata 拒绝、CSP 和无 CORS 策略继续生效。跨站顶层白板链接可以打开，但不会因此获得私有历史。没有匿名邀请签发或会话枚举接口。

每次连接生成新的绑定 ID 和 epoch。旧 cookie、邀请及命令不会跨越重载或会话替换。每个绑定最多四条 SSE 连接。SSE 先订阅再发当前快照，不回放旧命令；过期和撤销会关闭连接。慢连接的输出缓冲超过两份最大历史投影时关闭。心跳间隔十五秒。

## 历史与发送状态

`ctx.sessionManager.getBranch()` 是显示历史的来源。因此压缩前的当前分支原始消息仍可显示。`getEntries()` 包含的废弃分支不进入显示投影。

投影只包含用户文本、助手文本、工具名称和完成状态，以及压缩或错误提示。它不包含思考内容、系统提示、工具参数、工具结果正文、压缩摘要、Bash 输出或扩展私有消息。错误细节留在终端。用户或助手自己写在普通文本中的秘密无法被可靠识别；配对意味着允许该浏览器读取所选会话的这些文本。

显示项使用 `role` 判别的严格结构，不再用中文正文表达程序状态：

| role | 字段 | 限制 |
| --- | --- | --- |
| `user`、`assistant` | `id`、`role`、`text` | `text` 最多 32,768 个 UTF-16 代码单元。原文不翻译。 |
| `tool` | `id`、`role`、`name`、`status` | `name` 最多 100 个代码单元；`status` 为 `calling`、`completed` 或 `failed`。不含原始参数或结果。 |
| `notice` | `id`、`role`、`code` | `code` 为 `context-compacted`、`model-failed` 或 `reply-aborted`。 |

所有项的 `id` 最多 160 个代码单元。未知字段和旧的工具或提示 `text` 结构被拒绝。浏览器按代码本地化，绝不匹配或替换普通消息正文。

`ChatView.notice` 是以下代码之一或 `null`，不是显示文案：

| 代码 | 含义 |
| --- | --- |
| `input-submitted` | 调用了 Pi 提交 API，但未确认进入对话。 |
| `input-unobserved` | 八秒观察窗口内未看到对应输入。 |
| `submission-uncertain` | 提交调用结果不确定。 |
| `stop-requested` | 已请求停止，仍等待实际结束。 |
| `input-observed` | 观察到对应输入进入对话。 |
| `settled-unobserved` | Pi 已结束，但最终分支未确认浏览器输入。 |
| `run-ended` | 本次 Pi 运行已结束。 |

这是临时 chat 显示投影的协议变更，不是白板或 Pi 持久化迁移。没有旧格式兼容别名，更新扩展后需刷新浏览器。授权、请求去重和私有撤销注册器不变。

最多显示一百项、约 256 KiB 序列化投影。超出限制时显示截断提示。附件暂不显示。原始 Pi 历史不修改、不复制到另一份数据库。流式项是临时显示，在 `turn_end` 和 `agent_settled` 后重新读取持久化分支。`message_end` 本身不作为持久化完成的依据。

`send` 请求包含 `id`、`epoch`、`idleVersion` 和 `text`。文本最多 8,000 个代码单元。服务同步预约一个发送位置，并检查 Pi 空闲、无排队消息、无终端等待和最新空闲版本。以 `/` 或 `!` 开头的控制输入被拒绝。普通文本通过 `pi.sendUserMessage(text, { expandPromptTemplates: false })` 发送，不展开模板、技能或斜杠命令。

HTTP 202 的 `submitted` 只表示调用了 Pi 的 void 提交 API，不保证输入已被采用或模型已完成。实际消息和最终分支用于核对输入。其他扩展可以转换、消费或拒绝输入。八秒内未观察到对应消息时显示 `unknown`，保留草稿并要求检查终端。没有自动重发，也不无限占住一个不可见的“发送中”状态。

`abort` 请求包含 `id`、`epoch` 和当前 `runId`。每个实际 `agent_start` 都更换 runId，尚未进入运行的发送预约没有 runId。旧运行的请求不能取消新运行，自动续接或重试也会使旧目标失效。`stop-requested` 仍只是请求回执，实际 `agent_settled` 才解除运行状态。取消不回滚白板，也不替用户清除终端队列。

同一请求 ID 和同一内容返回原回执；同 ID 不同内容拒绝。每个连接最多记录 256 个命令，不通过淘汰旧 ID 来允许重复执行。达到限制后在 Pi 中 off 再连接。

## 音乐工具模式

唯一工具名是 `tele_board`，没有额外命名空间。操作如下：

- `catalogue` 返回固定和弦库。
- `get` 返回当前绑定白板。
- `put` 使用 `expectedRevision` 和完整 `content` 更新当前绑定白板。

工具不接受任意 board ID，不返回 capability。写入使用现有 `ContentSchema` 和原子提交后发布的版本 API。`get` 和 `catalogue` 忽略宿主为声明中的可选写入字段填入的值；`put` 仍要求完整校验。不存在的、无效的或冲突的修改不会发布。

连接期间只声明这个工具，并通过 `tool_call` 再次禁止其他模型工具。它是 `model-only` 工具，不提供嵌套执行其他工具的入口。工具声明 `destructiveHint: true`，因为 `put` 会替换白板。其他扩展的许可钩子照常运行，可能据此要求终端确认。普通终端文本没有被整体封禁，终端与浏览器仍由同一个 Pi 调度。

这不是操作系统沙箱。已信任的扩展仍以 Pi 用户权限运行，并且能够执行自己的代码。音乐模式只限制通过 Pi 工具调用通道执行的模型工具。不要加载不可信扩展，也不要把服务暴露到公网。

## 浏览器行为与限制

面板支持右侧、左侧、底部和折叠。窄屏固定在底部，不改写桌面位置偏好。白板使用容器宽度调整和弦列数。白板快照与对话流互不替换 DOM，输入框在流式更新、白板更新、折叠和位置切换时保持身份及草稿。阅读旧历史时不会自动滚到底部。

页眉提供 English 和简体中文语言选择，不放在对话面板内，收起及窄屏时仍可访问。`tele.locale` 保存 `en` 或 `zh-CN`。没有有效存储值时，浏览器首选语言以 `zh` 开头则使用简体中文，否则使用英语。存储被禁用时，当前页面仍可切换。切换更新 HTML `lang`、页面标题、程序生成的可见文案与无障碍标签，不发送 Pi 命令，不重写白板或历史，不替换输入框，也不打断或自动启动音频。用户与助手原文、会话名、白板标题说明和和弦符号保留原样。

localStorage 使用 `tele.locale`、`tele.chat.dock`、`tele.chat.collapsed` 和 `tele.chat.binding:<boardid>`，只保存语言、位置、折叠状态和非秘密绑定 ID。草稿不写入存储，刷新会丢失尚未发送的草稿。连接中断时禁止发送；重新读取状态不会重试发送。若网络响应不确定，先检查历史和 Pi 终端，确认后再重新连接，不要盲目再次发送。

`ui_prompt_start` 和 `ui_prompt_end` 使面板显示“需要终端操作”，并禁止新发送。扩展不能回答其他扩展的任意确认框；浏览器没有自动批准或伪造选择结果的接口。需要确认时回终端处理，或对实际运行请求停止。

## 可重复验证

`npm test` 包含真实 HTTP 的邀请、cookie、到期、Origin、epoch 撤销、SSE 限制与原有白板测试。状态测试覆盖忙碌、排队、请求去重、命令上限、未知提交和旧 abort。分支测试覆盖压缩前历史、废弃分支与私有字段排除。

`npm run verify:chat:probe` 启动独立无模型 Pi，用测试扩展建立临时历史并消费输入。它验证真实 Pi 的 UI 等待事件、历史、声明恢复、会话替换、浏览器配对和布局。语言检查覆盖英语与简体中文的可见文案及无障碍标签、回退与持久化、禁用存储、全部停靠及折叠、390px 手机无溢出。切换后核对输入框节点、焦点、选择区间、草稿、原始 Pi 消息和白板快照未变，且没有发送命令；用户文本恰好等于旧中文压缩提示时仍保留原文。另一个测试把输入暂停在外部扩展钩子内，在 off 后释放，确认它在任何 provider 请求之前被中止。因此 agent start 计数可能非零，但 provider request 必须为零；测试扩展还提供意外请求的中止保护。测试驱动明确拒绝测试对话框，产品本身不代为批准。

`npm run verify:chat:browser` 启动独立预览 Pi，只加载本扩展，只允许白板工具。最多三个用户输入分别建立真实 canary 历史、从浏览器依据旧历史修改白板、从浏览器中止下一次流式回复。它检查实际 Pi 会话文件、工具调用及更新后的同一页面。默认模型是 `github-copilot/gpt-6-luna`，可通过 `TELE_TEST_MODEL` 选择已配置模型。凭据只由 Pi 自己读取。每次运行会产生模型用量。

固定的 Pi 1.2.0 开发依赖在本次安装中带有三项 npm audit 告警，涉及上游 minimatch 和 undici 依赖树。`npm audit --omit=dev` 为零告警。这不表示宿主 Pi 没有风险；宿主的安全更新由 Pi 安装本身管理，本项目不改写它的全局配置或依赖。

验证使用临时数据目录和系统分配端口，不使用 4317，也不读取现有会话文件。结束时关闭自己的进程并移除临时数据。截图与不含配对秘密的报告放在 `.audit/chat/`，不提交生成的私有会话文件。
