# DSH board plugin / DSH 白板插件

## Scope and compatibility / 范围与兼容性

Tele v0.2.0 includes a DSH Host plugin exposing `tele_board` and keeps Pi support. It targets exactly DSH `0.2.2-rc.1`. It does not claim compatibility with other runtime versions. The npm instructions target v0.2.0. Confirm registry availability before installing.

Tele v0.2.0 提供 DSH 宿主白板工具，并保留 Pi 支持。DSH 插件不提供私有对话、音乐模式或内嵌 UI。它不读取 DSH 历史、不发送或停止 DSH 对话、不修改其他工具的可用性，也不自动打开浏览器。现有 Pi `/tele` 命令和配对对话只适用于 Pi。

This document describes the implementation and intended operation, not a deployment-specific acceptance report. Users should execute and record real-host verification separately; existing Pi and package checks do not replace that evidence.

## Install the npm package / 安装 npm 包

In DSH's **Plugin Manager**, install `@kyn0v/pi-tele@0.2.0`. Alternatively, ask your DSH agent to call `plugin_manager` with `action: install_bundle` and `target: @kyn0v/pi-tele@0.2.0`. The package includes built server and browser files. No source checkout, build, or installation scripts are required.

在 DSH 插件管理器中安装 npm 包 `@kyn0v/pi-tele@0.2.0`，或让 agent 使用同一个 spec 调用 `install_bundle`。包中已包含构建产物，不需要启用安装脚本。检查返回的激活结果。`failed` 或 `restart-required` 不代表插件已经运行。

npm publication makes the package installable by spec. It does not automatically list Tele in the DSH official market.

## Develop from local source / 从本地源码开发

To install a local checkout instead, prepare it in a shell:

```sh
cd /absolute/path/Tele
npm ci
npm run build
```

Then install `/absolute/path/Tele` through the Plugin Manager, or give that absolute directory as the agent's `install_bundle` target. After changing linked source, rebuild and follow the application's reported reload or restart outcome. This runtime can recompose a linked plugin and refresh changed module imports. A build alone does not prove that the running plugin uses the new files.

使用插件管理器管理启用、停用和移除；不要通过 shell 改写用户 profile 配置。不要为本插件启用未知安装脚本，也不要绕过版本检查。插件依赖已安装的 DSH tools 服务，通过 bundle patch 注册宿主入口。它不是 MCP 服务器。

The package root and `./dsh` export the DSH entrypoint; `./pi` and `pi.extensions` retain the Pi entrypoint. The [manifest](../package.json) declares the bundle patch, exact runtime engine, locales, and icon. No separate DSH account or cloud service is used.

## Configuration / 配置

Configure the plugin through the Plugin Manager, using its configuration schema:

| Field | Default | Contract |
| --- | --- | --- |
| `dataDir` | `~/.tele/dsh`, expanded to an absolute home path | Nonempty absolute path; a literal `~` path is not absolute. / 非空绝对路径，不能直接填写含 `~` 的相对形式。 |
| `port` | `0` | Integer 0–65535; 0 requests a free port. / 0 至 65535 的整数，0 请求空闲端口。 |

Unknown configuration fields are rejected. DSH configuration does not use Pi's `--tele-data`/`--tele-port` or the standalone `TELE_DATA`/`TELE_PORT` environment variables.

The DSH data directory is separate from the Pi/standalone default `~/.tele`. Data belongs outside the package and survives package replacement. One server owns a directory at a time, even if ports differ. Avoid pointing concurrently active DSH, Pi, or standalone servers at the same directory. Changing the plugin's port may change URLs; obtain a fresh URL from the tool rather than hard-coding one. No demo board is seeded by DSH activation.

同一 profile 中使用该插件的会话共享白板，没有按会话划分的私有存储；不同实例如果使用同一目录还会发生所有权冲突。停用应停止插件服务并释放锁，但不删除已保存白板。插件不会终止占用端口或目录的其他服务。崩溃后的锁处理遵循 [白板 API 参考](reference.md)，应先确认所有者已退出，不能猜测锁已过期。

## Tool contract / 工具契约

`tele_board` takes one of these commands. Unknown fields are rejected by runtime validation. Providers may fill declared optional fields even when they do not apply to the selected action: `catalogue` ignores `boardId`, `expectedRevision`, and `content`; `get` ignores `expectedRevision` and `content`. These fields never turn a read into a write. `get` still requires a valid `boardId`, and `put` strictly validates all required fields and complete content, even when the wire schema only marks `action` as universally required.

未知字段仍会被拒绝。为兼容 provider 自动填充的已声明可选字段，`catalogue` 忽略 `boardId`/`expectedRevision`/`content`，`get` 忽略 `expectedRevision`/`content`；`get` 的 `boardId` 与 `put` 的写入参数仍严格校验。

### Catalogue / 和弦库

```json
{ "action": "catalogue" }
```

Returns `{ "tuning": "standard", "chords": [...] }`. Inspect it before selecting chord symbols.

### Read / 读取

```json
{ "action": "get", "boardId": "harmony" }
```

`boardId` is required: 1–48 lowercase letters, digits or hyphens, starting with a letter or digit. A missing board returns:

```json
{ "boardId": "harmony", "exists": false, "revision": 0 }
```

An existing board returns `{ "id", "revision", "content", "url" }`. The URL addresses that board on the plugin's loopback service.

### Create or replace / 创建或替换

```json
{
  "action": "put",
  "boardId": "harmony",
  "expectedRevision": 0,
  "content": {
    "title": "Major IV and minor iv",
    "tempo": 90,
    "groups": [
      { "id": "major", "title": "Major IV", "chords": ["D", "G", "D"] },
      { "id": "minor", "title": "Minor iv", "chords": ["D", "Gm", "D"] }
    ]
  }
}
```

`boardId`, `expectedRevision`, and complete `content` are required. Use revision 0 only to create after confirming absence; use the revision returned by `get` for later updates. Successful writes return the saved board plus its URL. Every accepted write replaces the whole content and increments revision, including identical replacements. On a stale-revision conflict, reread and reconcile before retrying; never blindly overwrite or retry.

内容需要非空标题、1–12 个有唯一 ID 的分组，每组 1–32 个和弦；tempo 为 40–200，省略时默认 90。完整字段与容量规则见 [白板 API 参考](reference.md)。修改前读取白板，保留不需要改变的分组。写入被取消或失败不代表已有修改自动回滚；必要时重新读取确认结果。

Open a successful result's URL **manually in a browser on the DSH host**. This is a separate local webpage, not an embedded DSH panel. On a remote client, `127.0.0.1` refers to the client's own machine and is not automatically forwarded to the DSH host. Click chords or Play group to listen; updates reach an already open page through SSE and do not autoplay. The DSH board-only page reports `{ "chat": false, "chatPanel": false }` and does not display the Pi conversation panel. Pi and standalone page behavior remains unchanged.

## Security and boundaries / 安全边界

- The service binds only to `127.0.0.1`. Do not expose it to the internet or assume it is reachable from a remote DSH browser.
- Board reads are public to callers that can access this local service. Profile boards are shared, not private conversation storage. Do not copy private chat, credentials, or secrets into board content.
- HTTP writes retain the local capability token requirement and Host/Origin/cross-site protections. The DSH tool writes through the owned service in-process; the browser is not given the capability token. Never paste or commit that token.
- The DSH plugin creates no private-chat adapter or pairing invitation. It cannot approve host dialogs, bypass DSH authorization, restrict other tools, or provide an operating-system sandbox.
- Activation starts trusted plugin code with the host user's permissions. Resource cleanup must unregister the tool and stop the owned HTTP service; saved boards remain.
- Music limitations remain the same as the [README](../README.md#privacy-and-limitations): standard six-string tuning, fixed chord catalogue, whole-board updates, synthesized rather than recorded guitar audio, and no MCP integration.

## Verification status and checklist

This is an implementation reference and a reusable acceptance checklist, not a deployment-specific test report. Verify and record installation, activation, rendering, and lifecycle outcomes on the actual DSH host separately.

`verify:package` 要求压缩包包含 DSH 入口、patch、英中文元数据、图标及清单声明。它用结构化测试 context 仅通过生产依赖加载已打包 DSH 入口，检查网页资源和清理行为，并保留真实 Pi 安装、配对、CLI、重装与持久化检查。这项可移植性检查不运行真实 DSH 工具注册表，也不证明其他 DSH 版本兼容。不要把打包成功报告为真实 DSH 验收通过。

Two focused checks are available:

```sh
npm run verify:dsh
npm run verify:dsh:live -- http://127.0.0.1:PORT/b/board
```

Replace `PORT` and `board` with an existing live result URL. `verify:dsh` builds and runs independent fixture tests; it does not install or activate a real DSH plugin. `verify:dsh:live` performs read-only browser checks against the supplied live board URL. It does not create or update boards, validate the real DSH tool pipeline, or verify the Plugin Manager's GUI metadata or rendered icon. A screenshot of the standalone board is not evidence of those DSH GUI checks.

`verify:dsh` 是构建与独立 fixture 检查，`verify:dsh:live` 是给定真实白板 URL 的只读浏览器验证；两者不能代替真实 DSH 工具调用链和插件管理器 GUI 元数据的单独验收。

Real-host acceptance should record, on DSH `0.2.2-rc.1`:

1. Local installation and activation outcome, correct English/Chinese metadata and rendered icon, and availability of exactly the intended `tele_board` registration.
2. Catalogue, absent `get`, create, reread, replace, and stale-revision conflict with no unintended mutation; malformed inputs are rejected.
3. Returned URL reachable on the DSH host, chord rendering and user-initiated audio, and live SSE updates. No automatic browser launch or DSH chat exposure.
4. Local read boundary and HTTP capability/Origin protections; profile-shared board behavior is understood, with DSH's other tools and conversations unaffected.
5. Stop/reload/disable cleanup, closed connections and released lock, re-enable with persisted content, and no duplicate tool or server. Check failed activation/occupied-port cleanup too.
6. Unchanged Pi discovery, private chat, tool restoration, installed-package behavior, and existing tests.

Report observed successes, failures, and unverified browser or subjective-audio checks separately. Close real-DSH verification items only with evidence recorded on the actual host and runtime version.
