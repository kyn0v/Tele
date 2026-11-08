# Tele

[![npm version](https://img.shields.io/npm/v/%40kyn0v%2Fpi-tele)](https://www.npmjs.com/package/@kyn0v/pi-tele)

Interactive music tools for AI agents.

Tele v0.2.0 adds a DSH plugin for playable guitar chord boards and keeps Pi's board and private conversation support. Ask the agent to change a chord progression, then click the chords to hear it. The DSH plugin does not provide private chat, music mode, or an embedded DSH panel.

The npm instructions below target v0.2.0. Confirm that this version is available in the registry before installing.

English | [简体中文](README.zh-CN.md)

## Install the DSH board plugin

Tele v0.2.0 supports exactly DSH `0.2.2-rc.1`. It does not claim compatibility with other DSH versions.

In DSH's **Plugin Manager**, install the npm package spec `@kyn0v/pi-tele@0.2.0`. You can also ask your DSH agent to call `plugin_manager` with `action: install_bundle` and `target: @kyn0v/pi-tele@0.2.0`. The npm package includes built server and browser files. You do not need a source checkout, a build, or installation scripts. Inspect the returned activation outcome. A failed or restart-required result does not mean the plugin is running.

### Develop from local source

To install a local checkout instead, prepare it in a shell:

```sh
cd /absolute/path/Tele
npm ci
npm run build
```

Use the Plugin Manager to install `/absolute/path/Tele`, or give that absolute directory as the agent's `install_bundle` target. After source updates, rebuild and follow the application's reported reload or restart outcome. Linked plugins may reload through profile recomposition without a restart.

With either installation, ask the DSH agent to use `tele_board` to inspect the catalogue, read a board by `boardId`, then create or replace it with the current `expectedRevision` and complete `content`. Open the returned URL manually in a browser on the DSH host; Tele does not open it automatically. The browser is a separate local page, not a panel embedded in DSH, and it cannot read or send DSH chat. Its board-only capabilities (`chat: false`, `chatPanel: false`) hide the Pi conversation panel; Pi and standalone page behavior remains unchanged.

DSH defaults to `dataDir: ~/.tele/dsh` (expanded to an absolute home path) and `port: 0` (a free port). Configure a nonempty absolute `dataDir` and an integer port from 0 through 65535 through the Plugin Manager. Boards are shared across sessions using the plugin in the profile and readable by callers that can access its local service; do not store private conversation or secrets in them. The trusted plugin runs with the host user's permissions and does not provide an operating-system sandbox. See the [DSH integration reference](docs/dsh.md) for the tool contract and real-host checklist. `npm run verify:dsh` builds and runs independent fixture checks; `npm run verify:dsh:live -- http://127.0.0.1:PORT/b/board` checks an existing live board read-only. Neither establishes the real DSH tool pipeline or Plugin Manager GUI metadata verification.

## Install as a Pi package

You need Node.js 22.19 or newer, npm, and Pi 1.2. Install Tele:

```sh
pi install npm:@kyn0v/pi-tele
```

The package includes built server and browser files. You do not need to build it or enable installation scripts. Tele is also listed in the [Pi package gallery](https://pi.dev/packages/@kyn0v/pi-tele).

Use the installed package outside the Tele source directory to avoid loading it twice. In Pi, wait for active work to finish, then enter:

```text
/reload
/tele harmony
```

Open the private link within two minutes to pair your browser. The page shows the current branch's earlier messages and lets you continue the conversation beside the board. Do not share the link. Run `/tele off` to disconnect and restore Pi's previous tools.

To use a local source copy instead, build it before registering its absolute path:

```sh
cd /absolute/path/Tele
npm ci
npm run build
pi install /absolute/path/Tele
```

Local registration does not install dependencies or build files. Repeat `npm ci` and `npm run build` after updating the source. Use only one loading method: package registration, project discovery, or an explicit `-e` path.

## Load from source in an existing Pi session

If you have not registered Tele as a package, Pi can discover it in this project. Install dependencies and build the browser files in a shell. Do not start a standalone Tele server at the same time.

```sh
npm ci
npm run build
```

If Pi is already running in this project, wait for its current work and subtasks to finish. Trust the project extension, then enter these commands in the **Pi input box**, not in a shell.

```text
/reload
/tele harmony
```

Pi discovers `.pi/extensions/tele.js`, which imports `src/pi-extension.ts`. The extension can load without `dist`, but opening the board requires built browser files. `/tele harmony` starts the local server and gives you a one-time pairing link.

To launch a new Pi from another directory, explicitly load the source entrypoint.

```sh
pi -e /absolute/path/Tele/.pi/extensions/tele.js
```

After building, `pi -e /absolute/path/Tele/dist/pi-extension.js` is also supported. Choose one entrypoint. Do not load the extension through both project discovery and `-e`. If Pi uses a `--tools` allowlist, include `tele_board`.

Launching `pi` creates a new process. It does not attach to another live CLI. Do not open a session file that another Pi still owns. To continue an existing live session, use `/reload` and `/tele` in that original Pi.

While connected, the model can call only `tele_board`. Other extensions' confirmation dialogs still require the terminal; the browser cannot approve them. `/tele off` revokes the connection, stops Tele's server, waits for the run to finish, and restores the previous tools. Pi stays running, and saved board edits remain.

If a standalone server already owns the port or data directory, its owner must stop it before attaching Pi. Tele never kills another service. Ordinary board URLs do not grant access to private history or conversation controls. Do not share pairing links.

## Choose a browser language and layout

Use **Language** in the board header to select **English** or **简体中文**. The selector is outside the conversation panel and remains available when that panel is collapsed or on a phone.

Tele saves your choice in `tele.locale`. Without a valid saved choice, it uses Simplified Chinese if your primary browser language starts with `zh`, or English otherwise. If storage is blocked, you can still change the current page's language.

Switching languages changes controls, status messages, and accessibility labels. It does not translate messages, session names, board content, or chord symbols, or rewrite saved data. New data directories start with an English demo. Chinese example content stays Chinese in either interface language.

The conversation panel starts on the right. You can move it left or below the board, or collapse it. Tele remembers these choices. Phones use a bottom panel without changing your desktop preference.

Changing language or layout does not replace the input field or clear your draft. Enter sends, Shift+Enter adds a line, and Enter during IME composition does not send. Refreshing the page loses the draft.

## Run without Pi

You can play and update boards without Pi. From the Tele source directory, run:

```sh
npm ci
npm run build
npm start
```

Open <http://127.0.0.1:4317>. The home page opens a demo comparing major IV, D → G → D, with minor iv, D → Gm → D. It is a harmony teaching example, not a verified transcription of a song. The conversation panel explains that Pi is not connected.

Click a chord card or **Play group**. Each chord lasts two beats at the board's BPM. **Stop playback** cancels current and future notes. The browser starts audio only after a user gesture. A board update stops obsolete playback and never autoplays new content. Changing language preserves active playback and its Stop control.

## Create and update a board with your agent

Keep the standalone service running. In another terminal or an agent's command tool, run:

```sh
npm run board -- put harmony --expect 0 --file examples/major.json --open
npm run board -- get harmony
npm run board -- put harmony --expect 1 --file examples/comparison.json
npm run board -- catalogue
```

The first `put` creates the board and returns JSON containing `id`, `revision`, `content`, and `url`. `--open` invokes the system browser. The URL stays `/b/harmony` after updates. The existing page receives full replacements through SSE without a refresh.

Each write replaces the whole board and requires its current revision. Read the board first and keep any groups you do not want to change. On a 409 conflict, read the latest board before retrying. Use `npm run --silent board -- ...` for JSON output without npm's script banner.

An instruction you can give your agent:

> Run `npm run --silent board -- catalogue` to inspect available chords. Follow the structure in `examples/major.json` to create a JSON file with a title, ordered groups, and chords. Run `npm run --silent board -- put my-board --expect 0 --file /absolute/path/content.json --open`. Before each later update, `get my-board`, retain the groups we want, and replace the same board using the returned revision. On 409, read again instead of overwriting.

Another runnable example:

```sh
npm run board -- put cadence --expect 0 --file examples/cadence.json --open
```

CLI writes use the capability file in the local data directory. The browser does not hold that token. Never paste it into a conversation or commit it. Press Ctrl+C in the service's terminal to stop it and release its data lock.

## Use a different port or data directory

The Pi extension, standalone service, and CLI share `~/.tele` as the default data directory, outside the installed package. The DSH plugin instead defaults to `~/.tele/dsh` and takes `dataDir`/`port` from its plugin configuration, not Pi flags or `TELE_DATA`/`TELE_PORT`. Reinstalling the package does not replace boards or the local write capability. An explicit relative `TELE_DATA` path remains relative to your shell's working directory. Use an absolute path when commands run from different directories.

Tele does not find, move, or delete data from an old source directory automatically. To keep using existing boards, set `TELE_DATA=/absolute/path/old-checkout/.data` for both Pi and the CLI before starting them.

```sh
TELE_DATA=/tmp/my-tele TELE_PORT=4320 npm start
TELE_DATA=/tmp/my-tele TELE_PORT=4320 npm run board -- get demo
```

Only one service can own a data directory, even on different ports. A crash can leave `server.lock`, which prevents startup. Inspect its `owner.json` and confirm the old process has exited before manually removing that lock directory. Tele does not guess whether a lock is stale.

The Pi extension also accepts `--tele-port` and `--tele-data`, which override the matching environment variables. Port `0` asks the system for a free port. The standalone CLI's `TELE_PORT` requires a nonzero port. If Pi uses a custom port, set the same `TELE_PORT` for CLI commands. If Pi uses `--tele-data`, give the CLI the same directory through `TELE_DATA`.

## Privacy and limitations

Tele binds only to `127.0.0.1`. Board reads are public to callers that can access that local service. Board writes require a local capability. The private-chat rules below apply to the Pi connection only; the DSH plugin starts no chat bridge and restricts no other DSH tools. Pi private chat reads and commands require a paired browser cookie, scoped to one binding, with `HttpOnly`, `SameSite=Strict`, and an eight-hour expiry. Pairing links expire after two minutes and can be used once. Detach, reload, and session or branch replacement revoke the binding. Local HTTP has no TLS, and its cookie is not `Secure`. Do not expose the service to the internet.

A paired browser can read user and assistant text from the selected branch. Tele excludes thinking, system prompts, tool arguments and raw results, compaction summaries, and extension-private messages. It cannot reliably filter secrets from ordinary messages. The browser shows at most 100 items and about 256 KiB, with up to 32,768 UTF-16 code units per user or assistant item. It does not display attachments. Pi remains the only store of the conversation history.

A submission receipt does not mean the model has accepted or answered the message. If Tele cannot confirm what happened, it keeps the draft and does not resend it. Reconnecting reads the current state without replaying commands. Stopping a reply does not undo saved board changes or answer terminal dialogs.

Music mode is not an operating-system sandbox. Trusted extensions still run with Pi's user permissions. Tele restricts model tool calls, not arbitrary extension code. Do not load untrusted extensions.

The prototype supports local use, standard six-string tuning, a fixed chord catalogue, and whole-board updates. Web Audio generates a plucked-string sound; it does not play recorded guitar samples. Tele does not support capos, alternate tunings, chord editing, rhythm arrangement, cloud accounts, or an MCP plugin. Boards persist across normal restarts. Atomic file replacement does not guarantee recovery after power loss or on network filesystems.

## Verify changes

Start from a fresh source copy without `dist`:

```sh
npm ci
npm run verify:ci
```

`verify:ci` runs extension discovery, tests, build, Chromium installation, package checks, the no-model chat probe, and browser checks. It refuses to run if `dist` exists and does not delete build output. GitHub Ubuntu installs Chromium's system dependencies. On other Linux hosts, install those dependencies separately.

Set an absolute `PLAYWRIGHT_BROWSERS_PATH` to use a shared browser cache. Add `-- --artifact-dir /absolute/path/new-directory` to keep the tested tarball and metadata after all checks pass. See [publishing instructions](docs/publishing.md) for details.

`verify:extension` checks automatic project discovery in an offline Pi with temporary configuration, no saved session, and no `-e`. It sends no model prompt and does not generate `dist`.

`verify:package` builds and packs Tele, installs the tarball with production dependencies and lifecycle scripts disabled, and registers the installed directory in a disposable offline Pi. It checks private browser pairing, every shipped browser asset, installed CLI writes and conflicts, default home storage, and persistence after reinstall. Pi and Playwright come only from the development host. It also requires the DSH entrypoint, bundle patch, English and Chinese metadata, icon, and DSH manifest declarations in the packed artifact. A structural test context loads the packed DSH entrypoint with production dependencies, checks its assets, and checks cleanup. This portability smoke test does not run the real DSH tool registry. The package checks cover the tarball and Pi's local registration, not Pi's npm downloader or real DSH activation. It does not publish or change your Pi settings. Real DSH acceptance is performed separately; see the [DSH verification checklist](docs/dsh.md#verification-status-and-checklist).

`npm test` uses real HTTP services, temporary directories, and CLI processes. It covers music data, validation, conflicts, persistence, locks, SSE, private chat access, semantic notices, and locale coverage and fallback. Unit tests do not replace browser verification.

`verify:chat:probe` drives a real no-model Pi bridge and browser. It checks prior branch history, excluded private payloads, real terminal wait events, consumed-input uncertainty, tool restoration, session revocation, and delayed-input cancellation before provider work. It also tests both UI languages and accessibility labels, saved and fallback locales, blocked storage, unchanged drafts and history, every dock and collapse layout, and phone width without overflow.

`verify:browser` drives the production build and CLI. It checks linked navigation, natural audio completion, cancellation and obsolete-playback silence, language switching during playback, focus, keyboard controls, reconnect, and desktop and phone layouts. It renders production synthesis into WAV files and checks finite, nonzero, unclipped samples. These checks are not subjective listening. Use speakers or headphones to judge the sound.

Screenshots, WAV files, and reports are local artifacts under `.audit/browser/` and `.audit/chat/`. Scripts use temporary data and ports, close only their own processes, and remove temporary data.

The optional real-model check sends up to three user prompts to your configured Pi model and may incur charges:

```sh
npm run verify:chat:browser
# Optional model override:
TELE_TEST_MODEL=github-copilot/gpt-6-luna npm run verify:chat:browser
```

It checks earlier-conversation recall, streaming browser continuation, actual board-tool updates, persisted Pi history, and browser abort in a disposable Pi. It does not attach to your original CLI or change global Pi configuration.

## Documentation

The READMEs and browser-generated UI support English and Simplified Chinese. Other documents are not all translated.

- [DSH integration reference](docs/dsh.md) describes npm and local installation, configuration, the board tool, and the separate real-host verification checklist.
- [Board API reference](docs/reference.md) is in English and records exact fields, limits, security, and persistence.
- [Pi conversation reference](docs/chat-reference.md) is in Simplified Chinese and describes the private HTTP API, displayed messages, and session lifecycle.
- [Board design](docs/design.md) and [conversation design](docs/chat-design.md) are in English.
- [Publishing instructions](docs/publishing.md) cover CI, package verification, and OIDC releases.
- [Third-party notices](THIRD_PARTY_NOTICES.md) record dependencies and license boundaries.

## References

[TwoMoons](https://github.com/moayuisuda/two-moons) connects guitar fingering diagrams to playable pitches and is licensed under GPL-3.0. Tele used its design as a reference through the [kyn0v/two-moons fork](https://github.com/kyn0v/two-moons).

Tele does not use TwoMoons source code, audio samples, or other assets. Its HTML, CSS, diagrams, and synthesis were written separately. See [third-party notices](THIRD_PARTY_NOTICES.md).

Tele is licensed under the [MIT License](LICENSE), copyright 2026 Jian. Third-party licenses remain unchanged.
