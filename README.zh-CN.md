# Tele

[![npm 版本](https://img.shields.io/npm/v/%40kyn0v%2Fpi-tele)](https://www.npmjs.com/package/@kyn0v/pi-tele)

供 AI agent 使用的交互式音乐工具。

Tele v0.2.0 新增 DSH 吉他和弦白板插件，保留 Pi 白板和私有续聊功能。让 agent 修改和弦进行，再点击和弦试听。DSH 插件不提供私有续聊、音乐模式或 DSH 内嵌面板。

下面的 npm 安装说明固定使用 v0.2.0。安装前确认 npm 已提供该版本。

[English](README.md) | 简体中文

## 安装 DSH 白板插件

Tele v0.2.0 仅支持 DSH `0.2.2-rc.1`，不宣称兼容其他 DSH 版本。

在 DSH **插件管理器**中安装 npm 包 `@kyn0v/pi-tele@0.2.0`。也可以让 DSH agent 调用 `plugin_manager`，使用 `action: install_bundle`、`target: @kyn0v/pi-tele@0.2.0`。npm 包已包含构建好的服务端和浏览器文件，不需要源码目录、自行构建或启用安装脚本。检查返回的激活结果；`failed` 或 `restart-required` 不代表插件已经运行。

### 从本地源码开发

如果改用本地源码，先在 shell 中准备：

```sh
cd /absolute/path/Tele
npm ci
npm run build
```

通过插件管理器安装 `/absolute/path/Tele`，或将该绝对目录作为 agent 的 `install_bundle` target。更新源码后重新构建，并遵循应用返回的重载或重启结果。linked 插件可以通过 profile 重新组合刷新，不必每次都重启。

无论使用哪种安装方式，都可以让 DSH agent 调用 `tele_board` 查看和弦库，按 `boardId` 读取白板，再用当前 `expectedRevision` 和完整 `content` 创建或替换。手动在 **DSH 所在主机的浏览器**打开返回 URL；Tele 不会自动打开。白板是独立本机网页，不是 DSH 内嵌面板，也不能读取或发送 DSH 对话。DSH 白板模式返回 `chat: false`、`chatPanel: false`，页面不显示 Pi 续聊面板；Pi 和 standalone 页面行为不变。

DSH 默认使用 `dataDir: ~/.tele/dsh`（展开为绝对 home 路径）和 `port: 0`（系统分配空闲端口）。通过插件管理器配置非空绝对 `dataDir` 和 0 至 65535 的整数端口。同一 profile 中使用该插件的会话共享白板，能访问本机服务的调用方可以读取；不要写入私有对话或秘密。插件作为可信代码以宿主用户权限运行，不提供操作系统沙箱。工具契约与真实宿主清单见 [DSH 接入参考](docs/dsh.md)。`npm run verify:dsh` 执行构建和独立 fixture 检查；`npm run verify:dsh:live -- http://127.0.0.1:PORT/b/board` 对已有真实白板进行只读浏览器检查。两者不能证明真实 DSH 工具调用链或插件管理器 GUI 元数据已通过验证。

## 安装为 Pi 包

需要 Node.js 22.19 或更新版本、npm，以及 Pi 1.2。安装 Tele：

```sh
pi install npm:@kyn0v/pi-tele
```

包中已包含构建好的服务端和浏览器文件，不需要自行构建或启用安装脚本。也可以在 [Pi 包目录](https://pi.dev/packages/@kyn0v/pi-tele)找到 Tele。

请在 Tele 源码目录之外使用已安装的包，避免重复加载。在 Pi 中等当前工作结束，再输入：

```text
/reload
/tele harmony
```

在两分钟内打开私有链接，完成浏览器配对。页面会显示当前分支的旧消息，你可以在白板旁继续对话。不要分享配对链接。运行 `/tele off` 可断开连接并恢复 Pi 原来的工具。

如果使用本地源码，先构建，再注册绝对路径：

```sh
cd /absolute/path/Tele
npm ci
npm run build
pi install /absolute/path/Tele
```

本地注册不会安装依赖或构建文件。更新源码后，重新运行 `npm ci` 和 `npm run build`。包注册、项目自动发现和显式 `-e` 加载只选一种。

## 在已有 Pi 会话中加载源码

如果没有注册 Tele 包，Pi 可以从本项目中自动发现扩展。先在 shell 中安装依赖并构建浏览器文件。不要同时启动独立的 Tele 服务。

```sh
npm ci
npm run build
```

如果 Pi 已在本项目运行，先等当前工作和子任务结束。信任项目扩展后，在 **Pi 输入框**中执行以下命令，不是在 shell 中执行。

```text
/reload
/tele harmony
```

Pi 会发现 `.pi/extensions/tele.js`，由它导入 `src/pi-extension.ts`。扩展可以在没有 `dist` 时加载，但打开白板仍需构建浏览器文件。`/tele harmony` 启动本机服务，并给出一次性配对链接。

从其他目录启动一个新的 Pi 时，可以显式加载源码入口。

```sh
pi -e /absolute/path/Tele/.pi/extensions/tele.js
```

构建后也支持 `pi -e /absolute/path/Tele/dist/pi-extension.js`。各入口选一个，不要同时通过项目发现和 `-e` 重复加载。如果 Pi 使用 `--tools` 白名单，必须包含 `tele_board`。

启动 `pi` 会创建新进程，不会附着到另一个活跃 CLI。不要打开仍被另一个 Pi 使用的会话文件。要继续原来的活跃会话，请在原 Pi 中使用 `/reload` 和 `/tele`。

连接期间，模型只能调用 `tele_board`。其他扩展的确认框仍需在终端处理，浏览器不能代为批准。`/tele off` 会撤销连接、停止 Tele 服务、等待本轮运行结束，并恢复原来的工具。Pi 不会退出，已保存的白板修改也不会回滚。

如果独立服务已经占用该端口或数据目录，由其所有者先停止服务，再连接 Pi。Tele 不会终止其他服务。普通白板 URL 不授予私有历史或对话控制权。不要分享配对链接。

## 选择浏览器语言与布局

在白板页眉的 **语言**控件中选择 **English** 或 **简体中文**。选择器在对话面板外，面板收起或使用手机时仍可访问。

Tele 将选择保存在 `tele.locale` 中。如果没有有效的记录，浏览器首选语言以 `zh` 开头时使用简体中文，否则使用英语。即使存储被禁用，当前页面也能切换语言。

切换语言会更新控件、状态提示和无障碍标签，不会翻译消息、会话名、白板内容或和弦符号，也不会改写已保存的数据。新的数据目录使用英语示例。中文示例内容在两种界面语言下都保持中文。

对话面板默认在右侧，可以移到左侧或底部，也可以收起。Tele 会记住这些选择。手机使用底部面板，不改变桌面布局偏好。

切换语言或布局不会替换输入框或清空草稿。Enter 发送，Shift+Enter 换行；输入法组字时按 Enter 不会发送。刷新页面会丢失草稿。

## 不使用 Pi 运行白板

不连接 Pi 也能播放和更新白板。在 Tele 源码目录中运行：

```sh
npm ci
npm run build
npm start
```

打开 <http://127.0.0.1:4317>。首页进入教学白板，对比大四级 D → G → D 与小四级 D → Gm → D。这是和声教学示例，不是任何歌曲的已核实转录。对话面板会说明 Pi 尚未连接。

点击和弦卡片或 **播放整组**。每个和弦占两拍，速度由白板的 BPM 决定。**停止播放**取消当前和未来的音符。浏览器只有在用户操作后才启动音频。白板更新会停止旧播放，绝不自动播放新内容。语言切换保留当前播放及其停止控件。

## 让 agent 创建并更新白板

保持独立服务运行。在另一个终端或 agent 的命令工具中执行：

```sh
npm run board -- put harmony --expect 0 --file examples/major.json --open
npm run board -- get harmony
npm run board -- put harmony --expect 1 --file examples/comparison.json
npm run board -- catalogue
```

首次 `put` 创建白板，返回含 `id`、`revision`、`content`、`url` 的 JSON。`--open` 调用系统浏览器。更新后的 URL 仍是 `/b/harmony`，原页面通过 SSE 接收完整替换，无需刷新。

每次写入都会替换整块白板，并要求提供当前 revision。修改前先读取白板，保留不需要改动的分组。遇到 409 冲突时，先读取最新内容再重试。使用 `npm run --silent board -- ...` 可只输出 JSON，不显示 npm 的脚本名称。

可以给 agent 这样的指令：

> 运行 `npm run --silent board -- catalogue` 查看可用和弦。按 `examples/major.json` 的结构创建一个有标题、有序分组和和弦的 JSON 文件。运行 `npm run --silent board -- put my-board --expect 0 --file /absolute/path/content.json --open`。后续修改前先 `get my-board`，保留需要的分组，用读取到的 revision 完整替换同一块白板。遇到 409 先重新读取，不要盲目覆盖。

另一个可运行的例子：

```sh
npm run board -- put cadence --expect 0 --file examples/cadence.json --open
```

CLI 写入使用本机数据目录里的 capability 文件，浏览器不持有这个 token。不要把它贴入对话或提交到版本库。在服务所属的终端按 Ctrl+C，可停止服务并释放数据目录锁。

## 使用不同端口或数据目录

Pi 扩展、独立服务和 CLI 共用默认数据目录 `~/.tele`，位于安装包之外。DSH 插件则默认使用 `~/.tele/dsh`，从插件配置读取 `dataDir`/`port`，不使用 Pi flags 或 `TELE_DATA`/`TELE_PORT`。重新安装包不会替换白板或本机写入 capability。显式相对 `TELE_DATA` 路径仍相对于 shell 当前工作目录解析。不同目录中的命令应使用同一个绝对路径。

Tele 不会自动查找、移动或删除旧源码目录中的数据。如需继续使用已有白板，请在启动 Pi 和 CLI 前，为两者设置 `TELE_DATA=/absolute/path/old-checkout/.data`。

```sh
TELE_DATA=/tmp/my-tele TELE_PORT=4320 npm start
TELE_DATA=/tmp/my-tele TELE_PORT=4320 npm run board -- get demo
```

同一数据目录只允许一个服务，即使端口不同。崩溃后可能保留 `server.lock`，导致启动失败。先查看其中的 `owner.json` 并确认旧进程已退出，再手动移除锁目录。Tele 不自动猜测锁是否过期。

Pi 扩展也接受 `--tele-port` 和 `--tele-data`，优先于对应环境变量。端口 `0` 请求系统分配空闲端口。独立 CLI 的 `TELE_PORT` 必须是非零端口。Pi 使用自定义端口时，CLI 命令须设置相同的 `TELE_PORT`。Pi 使用 `--tele-data` 时，CLI 须通过 `TELE_DATA` 指向同一目录。

## 隐私与限制

Tele 只监听 `127.0.0.1`。白板读取对能访问本机服务的调用方公开，写入需要本机 capability。以下私有对话规则仅适用于 Pi 连接；DSH 插件不启动对话桥接，也不限制 DSH 的其他工具。Pi 私有对话读取和命令需要配对浏览器 cookie，限定一个绑定，带有 `HttpOnly`、`SameSite=Strict` 和八小时有效期。配对链接两分钟后失效，只能使用一次。断开、重载、会话替换或分支替换会撤销绑定。本机 HTTP 没有 TLS，cookie 不带 `Secure`。不要把服务暴露到公网。

配对后的浏览器可以读取所选分支的用户和助手文本。Tele 不显示思考内容、系统提示、工具参数与原始结果、压缩摘要或扩展私有消息，但无法可靠过滤普通消息中的秘密。浏览器最多显示 100 项、约 256 KiB 的内容，每项用户或助手文本最多 32,768 个 UTF-16 代码单元。不显示附件，对话历史仍只保存在 Pi 中。

收到提交回执，不代表模型已接受消息或完成回复。如果 Tele 无法确认结果，它会保留草稿，不会自动重发。重连只读取当前状态，不会重放命令。停止回复不会撤销已保存的白板修改，也不会处理终端确认框。

音乐模式不是操作系统沙箱。已信任扩展仍以 Pi 用户权限运行。Tele 限制模型工具调用，不限制扩展任意代码。不要加载不可信扩展。

当前原型支持本机使用、标准六弦调弦、固定和弦库和整块白板更新。Web Audio 合成近似拨弦的声音，不使用吉他录音。暂不支持变调夹、自定义调弦、和弦编辑、节奏编排、云端账号或 MCP 插件。白板可以在正常重启后恢复。文件原子替换不保证断电后或网络文件系统上的数据恢复。

## 验证改动

从没有 `dist` 的全新源码目录开始：

```sh
npm ci
npm run verify:ci
```

`verify:ci` 依次运行扩展发现、测试、构建、Chromium 安装、包检查、无模型对话探针和浏览器检查。如果已有 `dist`，它会拒绝运行，不会删除构建产物。GitHub Ubuntu 会安装 Chromium 的系统依赖，其他 Linux 主机需要另行安装。

可用绝对路径 `PLAYWRIGHT_BROWSERS_PATH` 指定共用浏览器缓存。添加 `-- --artifact-dir /absolute/path/new-directory`，可在全部检查通过后保留测试过的压缩包和元数据。详见[发布说明](docs/publishing.md)。

`verify:extension` 在离线 Pi 中检查项目自动发现，使用临时配置、不保存会话、不传 `-e`。它不发送模型输入，也不生成 `dist`。

`verify:package` 构建并打包 Tele，在只安装生产依赖且禁用生命周期脚本的环境中安装压缩包，再将安装目录注册到一次性离线 Pi。它检查浏览器私有配对、全部已分发浏览器资源、已安装 CLI 的写入与冲突、默认 home 数据目录，以及重装后的持久化。Pi 和 Playwright 只由开发宿主提供。它还要求压缩包包含 DSH 入口、bundle patch、英中文元数据、图标及 DSH 清单声明。结构化测试 context 会仅用生产依赖加载压缩包中的 DSH 入口，检查网页资源和清理行为；这项可移植性检查不运行真实 DSH 工具注册表。包验证覆盖压缩包和 Pi 本地注册，不覆盖 Pi 的 npm 下载器或真实 DSH 激活。它不会发布包或修改你的 Pi 设置。真实 DSH 验收单独执行，见 [DSH 验证清单](docs/dsh.md#verification-status-and-checklist)。

`npm test` 使用真实 HTTP 服务、临时目录和 CLI 子进程，覆盖乐理数据、校验、冲突、持久化、锁、SSE、私有对话授权、语义提示、语言词典覆盖和回退。单元测试不能替代浏览器验证。

`verify:chat:probe` 驱动真实无模型 Pi 桥接和浏览器。它检查当前分支旧历史、私有载荷排除、真实终端等待事件、被消费输入的不确定状态、工具恢复、会话撤销，以及挂起输入在 provider 工作前被中止。它也检查两种界面语言和无障碍标签、存储与回退、被禁用的存储、草稿和历史不变、全部停靠与折叠布局，以及手机宽度无溢出。

`verify:browser` 驱动生产构建和 CLI，检查链接导航、音频自然结束、取消与旧播放静音、播放中切换语言、焦点、键盘、重连及桌面和手机布局。它将生产合成渲染为 WAV，检查有限、非零且不削波的样本。这些检查不代表主观试听。请通过扬声器或耳机判断听感。

截图、WAV 和报告保存在本机 `.audit/browser/` 与 `.audit/chat/`。脚本使用临时数据和端口，只关闭自己的进程，并删除临时数据。

可选的真实模型检查最多发送三条用户消息，会消耗你配置的 Pi 模型额度，可能产生费用：

```sh
npm run verify:chat:browser
# 可选模型覆盖：
TELE_TEST_MODEL=github-copilot/gpt-6-luna npm run verify:chat:browser
```

它在一次性 Pi 中验证旧对话回忆、浏览器流式续聊、实际白板工具更新、Pi 历史持久化及浏览器停止回复。它不附着到你的原 CLI，也不修改全局 Pi 配置。

## 文档

README 和浏览器生成的界面支持英语和简体中文，其他文档并未全部翻译。

- [DSH 接入参考](docs/dsh.md)说明 npm 和本地安装、配置、白板工具及单独的真实宿主验证清单。
- [白板 API 参考](docs/reference.md)为英语，记录精确字段、容量、安全和持久化。
- [Pi 对话参考](docs/chat-reference.md)为简体中文，说明私有 HTTP 接口、消息显示规则和会话生命周期。
- [白板设计](docs/design.md)和[对话设计](docs/chat-design.md)为英语。
- [发布说明](docs/publishing.md)包含 CI、包验证和 OIDC 发布步骤。
- [第三方说明](THIRD_PARTY_NOTICES.md)记录依赖及许可证边界。

## 参考与许可

[TwoMoons](https://github.com/moayuisuda/two-moons) 将吉他指法图与可播放音高关联，采用 GPL-3.0 许可证。Tele 参考了它的产品设计，本地使用的是 [kyn0v/two-moons fork](https://github.com/kyn0v/two-moons)。

Tele 没有使用 TwoMoons 的源码、音频样本或其他素材。HTML、CSS、指板绘制和音频合成均单独编写。依赖与许可证说明见[第三方说明](THIRD_PARTY_NOTICES.md)。

Tele 采用 [MIT 许可证](LICENSE)，版权归属 2026 Jian。第三方许可证保持不变。
