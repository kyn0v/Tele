# AudioHarness

让任何能运行命令的 agent，把和声讲解变成浏览器里的吉他和弦白板。你点击和弦听声音，agent 在后续对话中更新同一个页面。

## 在白板旁继续当前 Pi 对话

需要 Node.js 22.19 或更新版本、npm，以及 Pi 1.2。先在 shell 中构建，不要同时启动独立服务：

```sh
npm ci
npm run build
```

如果当前 Pi 已在本项目运行，先等当前工作和子任务结束，再在 **Pi 输入框**中执行以下命令。这不是 shell 命令。项目扩展需要你信任该项目。

```text
/reload
/audioharness harmony
```

项目的 `.pi/extensions/audioharness.js` 会加载构建产物。连接命令打开一次性私有链接，两分钟内完成配对。页面显示当前 Pi 分支的旧对话；你可以发送后续问题、看流式回复，并让 agent 更新眼前的同一块白板。

如果从别的目录启动一个新的 Pi，可显式加载扩展。不要同时通过项目发现和 `-e` 重复加载，也不要让第二个 Pi 打开仍被使用的会话文件。

```sh
pi -e /absolute/path/AudioHarness/dist/pi-extension.js
```

如果该 Pi 使用 `--tools` 白名单，必须包含 `audioharness_board`。这会启动新的 Pi；它不是附着到另一个已经运行的 CLI。要继续原来的活跃会话，请使用原 Pi 中的项目扩展与 `/reload` 路径。

连接期间临时只开放白板工具，状态栏和面板都会标明。其他扩展的确认框仍需回终端处理，浏览器不会替你批准。在 Pi 中执行 `/audioharness off` 可撤销连接、停止扩展拥有的服务，并在运行结束后恢复原工具；Pi 本身不会退出。

面板默认在右侧，可以切到左侧或底部，也可以收起。位置、折叠状态会保存，草稿只留在当前页面。Enter 发送，Shift+Enter 换行。手机使用底部面板，不改写桌面偏好。

若 `npm start` 的独立服务已经占用同一端口或数据目录，由该服务的所有者先停止它，再连接 Pi。扩展不会杀死其他服务。普通白板 URL 不授予私有历史或对话控制权；不要分享一次性配对链接。

精确的接口、容量和安全限制见 [Pi 对话参考](docs/chat-reference.md)。

## 只启动白板并听一组和弦

不需要 Pi 时可以继续使用原来的独立服务。对话面板会显示未连接说明。

```sh
npm install
npm run build
npm start
```

打开 <http://127.0.0.1:4317>。首页自动进入教学白板，包含「大四级」D → G → D 和「小四级」D → Gm → D。这是和声教学示例，不是任何歌曲的已核实原版。

点击和弦卡片听合成拨弦，或点击「播放整组」。每个和弦占两拍，速度由白板的 BPM 决定。「停止播放」取消当前和未来的音符。浏览器需要一次用户点击才能启动音频。

## 让 agent 创建并更新白板

保持服务运行。在另一个终端或 agent 的命令工具中执行：

```sh
npm run board -- put harmony --expect 0 --file examples/major.json --open
npm run board -- get harmony
npm run board -- put harmony --expect 1 --file examples/comparison.json
npm run board -- catalogue
```

首次 `put` 创建白板，返回含 `id`、`revision`、`content`、`url` 的 JSON。`--open` 调用系统浏览器，也可以直接打开返回的 URL。更新后的 URL 仍是 `/b/harmony`。原页面通过 SSE 接收更新，无需刷新。更新会停止旧播放，绝不自动播放新内容。

`npm` 会额外输出脚本名称。要让工具只接收命令的 JSON 输出，使用 `npm run --silent board -- ...`。

对 agent 的实际指令可以是：

> 运行 `npm run --silent board -- catalogue` 查看可用和弦。用 `examples/major.json` 的结构创建一个有标题、有序分组和和弦的 JSON 文件，再运行 `npm run --silent board -- put my-board --expect 0 --file /absolute/path/content.json --open`。后续修改前先 `get my-board`，保留需要的旧分组，用读取到的 revision 完整替换同一块白板。遇到 409 先重新读取，不要盲目覆盖。

另一个可运行的例子：

```sh
npm run board -- put cadence --expect 0 --file examples/cadence.json --open
```

命令行写入需要本机数据目录里的 capability 文件。浏览器不持有这个 token。不要把它贴入对话或提交到版本库。运行停止服务的终端按 Ctrl+C，可释放数据目录锁。

## 用不同端口或数据目录运行

服务和 CLI 使用相同的环境变量。默认数据目录是本项目的 `.data`，不取决于当前工作目录。自定义目录建议使用绝对路径。

```sh
AUDIOHARNESS_DATA=/tmp/my-audioharness AUDIOHARNESS_PORT=4320 npm start
AUDIOHARNESS_DATA=/tmp/my-audioharness AUDIOHARNESS_PORT=4320 npm run board -- get demo
```

同一数据目录只允许一个服务，即使端口不同。崩溃后保留的 `server.lock` 会使启动失败。先查看其中的 `owner.json` 并确认旧进程已退出，再手动移除该锁目录。服务不自动猜测锁是否过期。

## 验证改动

```sh
npm test
npm run build
npx playwright install chromium --only-shell
npm run verify:browser
npm run verify:chat:probe
# 以下检查会使用 Pi 中已配置的模型，产生最多三个用户输入的用量：
npm run verify:chat:browser
```

`npm test` 使用真实 HTTP 服务和临时目录，覆盖乐理数据、校验、冲突、持久化、目录锁、SSE 和 CLI。它不等于浏览器验证。

`verify:browser` 启动生产构建，用生产 CLI 创建和更新页面。它检查来自其他站点的链接导航、单和弦及整组自然结束后的状态、更新与停止后的提示保留、无自动播放、SVG 图标响应、焦点、键盘、连接恢复及桌面和手机布局。

脚本挂起真实音频上下文，等待超过原定结束时间，更新白板后恢复渲染，并检查没有旧白板的 PCM 输出。离线渲染另行确认挂起时停止不会在恢复后泄漏尾音。脚本还从 `/assets/audio.js` 导入生产合成函数，在 `OfflineAudioContext` 中生成 D 和 Gm 的音频，检查有限、非零且不削波的样本。

原有截图、WAV 和报告写到 `.audit/browser/`。对话验证的截图和报告写到 `.audit/chat/`。无模型探针先验证当前分支历史、终端等待和撤销；真实模型检查再验证浏览器续聊、白板工具修改和停止。两者都是独立预览 Pi，不是你的原 CLI 会话。脚本最后关闭自己的浏览器和服务，并删除临时数据。

这些检查不代表主观试听。要判断听感，打开白板并通过你的扬声器或耳机实际聆听。

## POC 边界与参考

只支持本机、标准六弦调弦、固定和弦库及完整文档替换。声音是原创 Web Audio 合成拨弦，不是真实吉他录音。没有变调夹、自定义调弦、和弦编辑器、节奏编排、云端账号或 MCP 插件。

[接口与限制](docs/reference.md) 记录精确的字段、容量、安全边界和持久化保证。[白板设计](docs/design.md) 和 [对话设计](docs/chat-design.md) 记录已选方案。

TwoMoons 启发了「将吉他指法与可播放音高关联」这一产品方向。参考项目的 README 与 LICENSE 标明 GPL-3.0。本项目没有复制其代码、样本或其他素材。HTML、CSS、指板绘制与合成实现均为本项目原创。依赖及许可证说明见 [第三方说明](THIRD_PARTY_NOTICES.md)。本仓库目前不授予额外的源码再分发许可证。
