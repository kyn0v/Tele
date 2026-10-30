# AudioHarness

让任何能运行命令的 agent，把和声讲解变成浏览器里的吉他和弦白板。你点击和弦听声音，agent 在后续对话中更新同一个页面。

## 启动并听一组和弦

需要 Node.js 22 或更新版本，以及 npm。

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
```

`npm test` 使用真实 HTTP 服务和临时目录，覆盖乐理数据、校验、冲突、持久化、目录锁、SSE 和 CLI。它不等于浏览器验证。

`verify:browser` 启动生产构建，用生产 CLI 创建和更新页面，检查实时更新、播放停止、焦点、键盘、连接恢复及桌面和手机布局。它还从 `/assets/audio.js` 导入生产合成函数，在 `OfflineAudioContext` 中生成 D 和 Gm 的音频，检查有限、非零且不削波的样本。截图、WAV 和报告写到 `.audit/browser/`。脚本最后关闭浏览器和服务，并删除自己的临时数据。

这些检查不代表主观试听。要判断听感，打开白板并通过你的扬声器或耳机实际聆听。

## POC 边界与参考

只支持本机、标准六弦调弦、固定和弦库及完整文档替换。声音是原创 Web Audio 合成拨弦，不是真实吉他录音。没有变调夹、自定义调弦、和弦编辑器、节奏编排、云端账号或 MCP 插件。

[接口与限制](docs/reference.md) 记录精确的字段、容量、安全边界和持久化保证。[设计](docs/design.md) 记录已选方案。

TwoMoons 启发了「将吉他指法与可播放音高关联」这一产品方向。参考项目的 README 与 LICENSE 标明 GPL-3.0。本项目没有复制其代码、样本或其他素材。HTML、CSS、指板绘制与合成实现均为本项目原创。依赖及许可证说明见 [第三方说明](THIRD_PARTY_NOTICES.md)。本仓库目前不授予额外的源码再分发许可证。
