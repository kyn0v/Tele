# Tele

[![npm 版本](https://img.shields.io/npm/v/%40kyn0v%2Fpi-tele)](https://www.npmjs.com/package/@kyn0v/pi-tele)

A Harness for Musical Interaction.

为大模型提供可视、可听、可交互的音乐组件与操作接口。当前概念验证提供吉他和弦白板，以及由同一个活跃 Pi 会话拥有的对话面板。Agent 更新白板，你可以点击和弦听到结果。乐理讲解是其中一类用例，不是 Tele 的全部范围。

[English](README.md) | 简体中文

## 安装为 Pi 包

需要 Node.js 22.19 或更新版本、npm，以及 Pi 1.2。安装已公开发布的 npm 包：

```sh
pi install npm:@kyn0v/pi-tele
```

npm 压缩包包含已构建的运行文件与浏览器资源，不需要安装脚本。0.1.0 已公开发布，并列入 [Pi 包目录](https://pi.dev/packages/@kyn0v/pi-tele)。该版本内嵌的 README 写于发布前，已发布的包不可修改。本次修正文档将在下一次获授权的版本发布后进入 npm。

在 Pi 中等当前工作结束，再运行 `/reload` 和 `/tele harmony`。为避免重复加载，请在 Tele checkout 外使用已注册的包。不要同时使用包注册、项目自动发现或显式 `-e` 加载。

本地开发时，可以改为构建 checkout 并注册绝对路径：

```sh
cd /absolute/path/Tele
npm ci
npm run build
pi install /absolute/path/Tele
```

本地注册不会安装依赖或构建资源。克隆或更新 checkout 后，先执行前三条命令。CI、已验证压缩包的原样导出和由所有者控制的发布步骤见[发布已审核的 Pi 包](docs/publishing.md)。

## 在白板旁继续当前 Pi 对话

不注册包的源码开发可使用下面的项目发现方式。

需要 Node.js 22.19 或更新版本、npm，以及 Pi 1.2。在 shell 中安装依赖并构建浏览器资源，不要同时启动独立服务。

```sh
npm ci
npm run build
```

如果 Pi 已在本项目运行，先等当前工作和子任务结束。信任项目扩展后，在 **Pi 输入框**中执行以下命令，不是在 shell 中执行。

```text
/reload
/tele harmony
```

Pi 自动发现 `.pi/extensions/tele.js`，通过 Pi 的 TypeScript 加载器导入 `src/pi-extension.ts`。安装依赖后即可加载扩展，不依赖 `dist`；打开白板仍需先构建浏览器资源。`/tele harmony` 启动扩展拥有的本机服务，并提供一次性私有链接。两分钟内打开链接完成配对。页面显示当前 Pi 分支的旧对话，可以继续该对话、查看流式回复，并更新同一块白板。

从其他目录启动一个新的 Pi 时，可以显式加载源码入口。

```sh
pi -e /absolute/path/Tele/.pi/extensions/tele.js
```

构建后也支持 `pi -e /absolute/path/Tele/dist/pi-extension.js`。各入口选一个，不要同时通过项目发现和 `-e` 重复加载。如果 Pi 使用 `--tools` 白名单，必须包含 `tele_board`。

启动 `pi` 会创建新进程，不会附着到另一个活跃 CLI。不要打开仍被另一个 Pi 使用的会话文件。要继续原来的活跃会话，请在原 Pi 中使用 `/reload` 和 `/tele`。

连接期间，音乐模式临时只允许模型调用 `tele_board`。其他扩展的确认框仍需在终端处理，浏览器不能代为批准。在 Pi 中执行 `/tele off` 可撤销连接、停止扩展拥有的服务、等待运行结束，并恢复原工具。Pi 本身不会退出，已经提交的白板修改不会回滚。

如果独立服务已经占用该端口或数据目录，由其所有者先停止服务，再连接 Pi。Tele 不会终止其他服务。普通白板 URL 不授予私有历史或对话控制权。不要分享配对链接。

## 选择浏览器语言与布局

在白板页眉的 **语言**控件中选择 **English** 或 **简体中文**。选择器在对话面板外，面板收起或使用手机时仍可访问。

没有保存的选择时，浏览器首选语言以 `zh` 开头则使用简体中文，否则使用英语。`tele.locale` 保存选择。无效存储值按浏览器规则回退。如果存储被禁用，当前页面仍可切换语言。

语言切换更新程序生成的控件、状态提示和无障碍标签。它不翻译用户或助手消息、会话名、白板标题与说明、和弦符号。已有白板和 Pi 历史不会被改写。新的空实例使用英语教学示例，已有中文示例文件在两种界面语言下都保留中文内容。

对话面板默认在右侧，可以切到左侧或底部，也可以收起。位置和折叠偏好会保存。手机使用底部面板，不覆盖桌面偏好。语言和布局切换保留输入框节点与草稿。Enter 发送，Shift+Enter 换行，输入法组字期间不会提交。草稿只留在当前页面，刷新后丢失。

## 启动独立听觉白板

白板播放和 CLI 更新不需要 Pi。在 shell 中运行：

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

每次写入都需要当前 revision。修改前先读取白板，保留需要的分组，再完整替换内容。遇到 409 冲突时重新读取并调整，不要盲目覆盖。Agent 只需要 JSON 输出时，使用 `npm run --silent board -- ...`，避免 npm 的脚本名称输出。

可以给 agent 这样的指令：

> 运行 `npm run --silent board -- catalogue` 查看可用和弦。按 `examples/major.json` 的结构创建一个有标题、有序分组和和弦的 JSON 文件。运行 `npm run --silent board -- put my-board --expect 0 --file /absolute/path/content.json --open`。后续修改前先 `get my-board`，保留需要的分组，用读取到的 revision 完整替换同一块白板。遇到 409 先重新读取，不要盲目覆盖。

另一个可运行的例子：

```sh
npm run board -- put cadence --expect 0 --file examples/cadence.json --open
```

CLI 写入使用本机数据目录里的 capability 文件，浏览器不持有这个 token。不要把它贴入对话或提交到版本库。在服务所属的终端按 Ctrl+C，可停止服务并释放数据目录锁。

## 使用不同端口或数据目录

扩展、独立服务和 CLI 共用默认数据目录 `~/.tele`，位于安装包之外。重新安装包不会替换白板或本机写入 capability。显式相对 `TELE_DATA` 路径仍相对于 shell 当前工作目录解析。不同目录中的命令应使用同一个绝对路径。

旧 checkout 数据不会被自动发现、移动或删除。如需继续使用已有白板，请在启动 Pi 和 CLI 前，为两者设置 `TELE_DATA=/absolute/path/old-checkout/.data`。

```sh
TELE_DATA=/tmp/my-tele TELE_PORT=4320 npm start
TELE_DATA=/tmp/my-tele TELE_PORT=4320 npm run board -- get demo
```

同一数据目录只允许一个服务，即使端口不同。崩溃后可能保留 `server.lock`，导致启动失败。先查看其中的 `owner.json` 并确认旧进程已退出，再手动移除锁目录。Tele 不自动猜测锁是否过期。

Pi 扩展也接受 `--tele-port` 和 `--tele-data`，优先于对应环境变量。端口 `0` 请求系统分配空闲端口。独立 CLI 的 `TELE_PORT` 必须是非零端口。Pi 使用自定义端口时，CLI 命令须设置相同的 `TELE_PORT`。Pi 使用 `--tele-data` 时，CLI 须通过 `TELE_DATA` 指向同一目录。

## 隐私与概念验证边界

Tele 只监听 `127.0.0.1`。白板读取对能访问本机服务的调用方公开，写入需要本机 capability。私有对话读取和命令需要配对浏览器 cookie，限定一个绑定，带有 `HttpOnly`、`SameSite=Strict` 和八小时有效期。配对链接两分钟后失效，只能使用一次。断开、重载、会话替换或分支替换会撤销绑定。本机 HTTP 没有 TLS，cookie 不带 `Secure`。不要把服务暴露到公网。

配对允许浏览器读取所选分支的用户和助手文本。Tele 排除思考内容、系统提示、工具参数与原始结果、压缩摘要和扩展私有消息。普通用户或助手文本中的秘密无法被可靠过滤。显示投影最多一百项、约 256 KiB，用户和助手每项文本最多 32,768 个 UTF-16 代码单元。附件不显示，原始 Pi 记录仍是唯一的对话数据库。

提交回执不证明模型已经接受输入或完成回复。未观察到或结果不确定的提交保留草稿，绝不自动重发。重新连接只读取状态，不回放命令。停止请求限定当前运行，不撤销已提交的白板修改，也不处理终端确认框。

音乐模式不是操作系统沙箱。已信任扩展仍以 Pi 用户权限运行。Tele 限制模型工具调用，不限制扩展任意代码。不要加载不可信扩展。

当前 POC 只支持本机、标准六弦调弦、固定和弦库及完整文档替换。原创 Web Audio 合成近似拨弦声音，不是真实吉他录音。没有变调夹、自定义调弦、和弦编辑器、节奏编排、云端账号或 MCP 插件。本机文件原子替换支持正常重启后的持久化，不保证断电耐久性或网络文件系统恢复。

## 验证改动

在已安装依赖、尚无 `dist` 的新 checkout 中，先验证项目扩展发现，再构建：

```sh
npm ci
npm run verify:ci
```

`verify:ci` 按顺序运行扩展发现、测试、构建、Chromium 安装、包验证、无模型对话探针和浏览器验证。已有 `dist` 时会失败，不会删除构建产物。GitHub Ubuntu 会安装 Chromium 的系统依赖，其他 Linux 主机须另行安装这些依赖。可用绝对路径 `PLAYWRIGHT_BROWSERS_PATH` 指定共用浏览器缓存。添加 `-- --artifact-dir /absolute/path/new-directory`，可在整套检查成功后原样保留已验证的压缩包和元数据。前置条件与产物边界见[发布说明](docs/publishing.md)。

`verify:extension` 在离线 Pi 中检查项目自动发现，使用临时配置、不保存会话、不传 `-e`。它不发送模型输入，也不生成 `dist`。

`verify:package` 构建并打包 Tele，在只安装生产依赖且禁用生命周期脚本的环境中安装压缩包，再将安装目录注册到一次性离线 Pi。它检查浏览器私有配对、全部已分发浏览器资源、已安装 CLI 的写入与冲突、默认 home 数据目录，以及重装后的持久化。Pi 和 Playwright 只由开发宿主提供。此验证覆盖压缩包和 Pi 本地注册，不覆盖 Pi 的 npm 下载器。它不会发布包或修改你的 Pi 设置。

`npm test` 使用真实 HTTP 服务、临时目录和 CLI 子进程，覆盖乐理数据、校验、冲突、持久化、锁、SSE、私有对话授权、语义提示、语言词典覆盖和回退。单元测试不能替代浏览器验证。

`verify:chat:probe` 驱动真实无模型 Pi 桥接和浏览器。它检查当前分支旧历史、私有载荷排除、真实终端等待事件、被消费输入的不确定状态、工具恢复、会话撤销，以及挂起输入在 provider 工作前被中止。它也检查两种界面语言和无障碍标签、存储与回退、被禁用的存储、草稿和历史不变、全部停靠与折叠布局，以及手机宽度无溢出。

`verify:browser` 驱动生产构建和 CLI，检查链接导航、音频自然结束、取消与旧播放静音、播放中切换语言、焦点、键盘、重连及桌面和手机布局。它将生产合成渲染为 WAV，检查有限、非零且不削波的样本。这些检查不代表主观试听。请通过扬声器或耳机判断听感。

截图、WAV 和报告保存在本机 `.audit/browser/` 与 `.audit/chat/`。脚本使用临时数据和端口，只关闭自己的进程，并删除临时数据。

可选的真实模型验证最多发送三个用户输入，会产生 Pi 已配置模型的用量。它与无模型探针分开运行：

```sh
npm run verify:chat:browser
# 可选模型覆盖：
TELE_TEST_MODEL=github-copilot/gpt-6-luna npm run verify:chat:browser
```

它在一次性 Pi 中验证旧对话回忆、浏览器流式续聊、实际白板工具更新、Pi 历史持久化及浏览器停止回复。它不附着到你的原 CLI，也不修改全局 Pi 配置。

## 文档

README 和浏览器生成的界面支持英语和简体中文，其他文档并未全部翻译。

- [白板 API 参考](docs/reference.md)为英语，记录精确字段、容量、安全和持久化。
- [Pi 对话参考](docs/chat-reference.md)为简体中文，记录私有 HTTP、语义投影代码和生命周期边界。
- [白板设计](docs/design.md)和[对话设计](docs/chat-design.md)为英语。
- [发布已审核的 Pi 包](docs/publishing.md)说明 CI、原样产物验证和未来获授权的 OIDC 发布步骤。
- [第三方说明](THIRD_PARTY_NOTICES.md)记录依赖及许可证边界。

## References

[TwoMoons](https://github.com/moayuisuda/two-moons) 是将吉他指法与可播放音高关联的原始上游产品参考，上游采用 GPL-3.0。本地参考 checkout 是 [kyn0v/two-moons](https://github.com/kyn0v/two-moons) fork，主要归属仍为原始上游。

Tele 仅将 TwoMoons 作为参考，没有导入或复制其源码、音频样本或其他素材。本项目的 HTML、CSS、指板绘制与合成均为独立实现。依赖及许可证说明见[第三方说明](THIRD_PARTY_NOTICES.md)。Tele 源码采用 [MIT 许可证](LICENSE)，版权归属 2026 Jian。第三方许可证保持不变。
