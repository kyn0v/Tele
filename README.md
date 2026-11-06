# Tele

[![npm version](https://img.shields.io/npm/v/%40kyn0v%2Fpi-tele)](https://www.npmjs.com/package/@kyn0v/pi-tele)

A Harness for Musical Interaction.

Tele gives language models visual, audible, interactive music components and tools. The current proof of concept combines a guitar chord board with a conversation panel owned by the same live Pi session. Your agent updates the board, and you click chords to hear the result. Music theory explanations are one class of use cases, not the product's whole scope.

English | [简体中文](README.zh-CN.md)

## Install as a Pi package

Requires Node.js 22.19 or newer, npm, and Pi 1.2. Install the public npm package:

```sh
pi install npm:@kyn0v/pi-tele
```

npm tarballs contain prebuilt runtime and browser files and need no install scripts. Version 0.1.0 is public and listed in the [Pi package gallery](https://pi.dev/packages/@kyn0v/pi-tele). Its immutable packed README predates publication. This corrected README reaches npm with the next authorized version.

In Pi, wait for active work to finish, then run `/reload` and `/tele harmony`. To avoid duplicate loading, use the installed package from outside the Tele checkout. Do not combine package registration with project auto-discovery or explicit `-e` loading.

For local development, build a checkout and register its absolute path instead:

```sh
cd /absolute/path/Tele
npm ci
npm run build
pi install /absolute/path/Tele
```

Local registration does not install dependencies or build assets. Run the first three commands after cloning or updating the checkout. See [Publish a reviewed Pi package](docs/publishing.md) for CI, exact tested tarball export, and the owner-controlled release procedure.

## Continue your current Pi conversation beside a board

For source development without package registration, use the project-discovery route below.

Requires Node.js 22.19 or newer, npm, and Pi 1.2. Install dependencies and build browser assets in a shell. Do not start the standalone service at the same time.

```sh
npm ci
npm run build
```

If Pi is already running in this project, wait for its current work and subtasks to finish. Trust the project extension, then enter these commands in the **Pi input box**, not in a shell.

```text
/reload
/tele harmony
```

Pi discovers `.pi/extensions/tele.js`, which imports `src/pi-extension.ts` through Pi's TypeScript loader. The extension can load after dependency installation without `dist`. Opening a board still requires built browser assets. `/tele harmony` starts an owned loopback service and provides a one-time private link. Open it within two minutes to pair. The page shows prior messages on the current Pi branch and lets you continue that conversation, watch streaming replies, and update the same board.

To launch a new Pi from another directory, explicitly load the source entrypoint.

```sh
pi -e /absolute/path/Tele/.pi/extensions/tele.js
```

After building, `pi -e /absolute/path/Tele/dist/pi-extension.js` is also supported. Choose one entrypoint. Do not load the extension through both project discovery and `-e`. If Pi uses a `--tools` allowlist, include `tele_board`.

Launching `pi` creates a new process. It does not attach to another live CLI. Do not open a session file that another Pi still owns. To continue an existing live session, use `/reload` and `/tele` in that original Pi.

While attached, music mode temporarily allows only `tele_board` for model tool calls. Other extensions' confirmation dialogs still require the terminal. The browser cannot approve them. Run `/tele off` in Pi to revoke the connection, stop the extension-owned service, wait for settlement, and restore the previous tools. Pi stays running. Committed board edits are not rolled back.

If a standalone server already owns the port or data directory, its owner must stop it before attaching Pi. Tele never kills another service. Ordinary board URLs do not grant access to private history or conversation controls. Do not share pairing links.

## Choose a browser language and layout

Use **Language** in the board header to select **English** or **简体中文**. The selector is outside the conversation panel and remains available when that panel is collapsed or on a phone.

Without a saved choice, a primary browser language beginning with `zh` selects Simplified Chinese. All other languages select English. `tele.locale` stores your choice. Invalid saved values fall back to the browser rule. If storage is blocked, language selection still works for the current page.

Language changes update generated controls, status messages, and accessibility labels. They do not translate user or assistant messages, session names, board titles or descriptions, or chord symbols. Existing boards and Pi histories are never rewritten. New empty instances use an English teaching demo. Existing Chinese example files remain Chinese content in either UI language.

The conversation panel docks right by default. Choose left or bottom, or collapse it. Docking and collapse preferences persist. Phones use a bottom panel without overwriting the desktop preference. Language changes and layout changes preserve the composer node and draft. Enter sends, Shift+Enter inserts a newline, and IME composition does not submit. Drafts stay only on the current page and are lost on refresh.

## Run a standalone listening board

Pi is optional for board playback and CLI updates. In a shell, run:

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

Every write requires the current revision. Before updating, read the board, keep any groups you want to preserve, and replace the complete content. On a 409 conflict, read again and reconcile rather than blindly overwrite. Use `npm run --silent board -- ...` when your agent needs only JSON output, without npm's script banner.

An instruction you can give your agent:

> Run `npm run --silent board -- catalogue` to inspect available chords. Follow the structure in `examples/major.json` to create a JSON file with a title, ordered groups, and chords. Run `npm run --silent board -- put my-board --expect 0 --file /absolute/path/content.json --open`. Before each later update, `get my-board`, retain the groups we want, and replace the same board using the returned revision. On 409, read again instead of overwriting.

Another runnable example:

```sh
npm run board -- put cadence --expect 0 --file examples/cadence.json --open
```

CLI writes use the capability file in the local data directory. The browser does not hold that token. Never paste it into a conversation or commit it. Press Ctrl+C in the service's terminal to stop it and release its data lock.

## Use a different port or data directory

The extension, standalone service, and CLI share `~/.tele` as the default data directory, outside the installed package. Reinstalling the package does not replace boards or the local write capability. An explicit relative `TELE_DATA` path remains relative to your shell's working directory. Use an absolute path when commands run from different directories.

Old checkout data is not discovered, moved, or deleted. To keep using existing boards, set `TELE_DATA=/absolute/path/old-checkout/.data` for both Pi and the CLI before starting them.

```sh
TELE_DATA=/tmp/my-tele TELE_PORT=4320 npm start
TELE_DATA=/tmp/my-tele TELE_PORT=4320 npm run board -- get demo
```

Only one service can own a data directory, even on different ports. A crash can leave `server.lock`, which prevents startup. Inspect its `owner.json` and confirm the old process has exited before manually removing that lock directory. Tele does not guess whether a lock is stale.

The Pi extension also accepts `--tele-port` and `--tele-data`, which override the matching environment variables. Port `0` asks the system for a free port. The standalone CLI's `TELE_PORT` requires a nonzero port. If Pi uses a custom port, set the same `TELE_PORT` for CLI commands. If Pi uses `--tele-data`, give the CLI the same directory through `TELE_DATA`.

## Privacy and proof-of-concept limits

Tele binds only to `127.0.0.1`. Board reads are public to callers that can access that local service. Board writes require a local capability. Private chat reads and commands require a paired browser cookie, scoped to one binding, with `HttpOnly`, `SameSite=Strict`, and an eight-hour expiry. Pairing links expire after two minutes and can be used once. Detach, reload, and session or branch replacement revoke the binding. Local HTTP has no TLS, and its cookie is not `Secure`. Do not expose the service to the internet.

Pairing allows that browser to read the selected branch's user and assistant text. Tele excludes thinking, system prompts, tool arguments and raw results, compaction summaries, and extension-private messages. Secrets written in ordinary user or assistant text cannot be reliably filtered. The projection shows at most 100 items and about 256 KiB, with user and assistant text limited to 32,768 UTF-16 code units per item. Attachments are not displayed. The original Pi record remains the only transcript database.

A submission receipt does not prove model acceptance or completion. Unobserved or uncertain submissions retain the draft and are never automatically resent. Reconnecting reads status without replaying commands. Stop requests target the current run and do not undo committed board changes or resolve terminal dialogs.

Music mode is not an operating-system sandbox. Trusted extensions still run with Pi's user permissions. Tele restricts model tool calls, not arbitrary extension code. Do not load untrusted extensions.

This POC supports local use, standard six-string tuning, a fixed chord catalogue, and full document replacement. Its original Web Audio synthesis approximates plucked strings. It is not recorded guitar audio. There is no capo, alternate tuning, chord editor, rhythm arrangement, cloud account, or MCP plugin. Local-file atomic replacement supports normal restart persistence, not a guarantee of power-loss durability or network-filesystem recovery.

## Verify changes

Run extension discovery in a fresh checkout with dependencies installed and no `dist`, before building:

```sh
npm ci
npm run verify:ci
```

`verify:ci` runs extension discovery, tests, build, Chromium installation, package verification, the no-model chat probe, and browser verification in order. It rejects an existing `dist` without deleting it. GitHub Ubuntu installs Chromium's OS dependencies. Other Linux hosts need those dependencies installed separately. Set an absolute `PLAYWRIGHT_BROWSERS_PATH` to choose a shared browser cache. To retain only the exact tested tarball and metadata after the whole gate succeeds, add `-- --artifact-dir /absolute/path/new-directory`. See the [release instructions](docs/publishing.md) for prerequisites and artifact limits.

`verify:extension` checks automatic project discovery in an offline Pi with temporary configuration, no saved session, and no `-e`. It sends no model prompt and does not generate `dist`.

`verify:package` builds and packs Tele, installs the tarball with production dependencies and lifecycle scripts disabled, and registers the installed directory in a disposable offline Pi. It checks private browser pairing, every shipped browser asset, installed CLI writes and conflicts, default home storage, and persistence after reinstall. Pi and Playwright come only from the development host. This tests the tarball and Pi's local registration, not its npm downloader. It does not publish or change your Pi settings.

`npm test` uses real HTTP services, temporary directories, and CLI processes. It covers music data, validation, conflicts, persistence, locks, SSE, private chat access, semantic notices, and locale coverage and fallback. Unit tests do not replace browser verification.

`verify:chat:probe` drives a real no-model Pi bridge and browser. It checks prior branch history, excluded private payloads, real terminal wait events, consumed-input uncertainty, tool restoration, session revocation, and delayed-input cancellation before provider work. It also tests both UI languages and accessibility labels, saved and fallback locales, blocked storage, unchanged drafts and history, every dock and collapse layout, and phone width without overflow.

`verify:browser` drives the production build and CLI. It checks linked navigation, natural audio completion, cancellation and obsolete-playback silence, language switching during playback, focus, keyboard controls, reconnect, and desktop and phone layouts. It renders production synthesis into WAV files and checks finite, nonzero, unclipped samples. These checks are not subjective listening. Use speakers or headphones to judge the sound.

Screenshots, WAV files, and reports are local artifacts under `.audit/browser/` and `.audit/chat/`. Scripts use temporary data and ports, close only their own processes, and remove temporary data.

The optional model proof makes up to three user prompts and incurs usage on the configured Pi model. It is separate from the no-model probe:

```sh
npm run verify:chat:browser
# Optional model override:
TELE_TEST_MODEL=github-copilot/gpt-6-luna npm run verify:chat:browser
```

It checks earlier-conversation recall, streaming browser continuation, actual board-tool updates, persisted Pi history, and browser abort in a disposable Pi. It does not attach to your original CLI or change global Pi configuration.

## Documentation

The READMEs and browser-generated UI support English and Simplified Chinese. Other documents are not all translated.

- [Board API reference](docs/reference.md) is in English and records exact fields, limits, security, and persistence.
- [Pi conversation reference](docs/chat-reference.md) is in Simplified Chinese and records private HTTP, semantic projection codes, and lifecycle limits.
- [Board design](docs/design.md) and [conversation design](docs/chat-design.md) are in English.
- [Publish a reviewed Pi package](docs/publishing.md) covers CI, exact artifact verification, and future authorized OIDC releases.
- [Third-party notices](THIRD_PARTY_NOTICES.md) record dependencies and license boundaries.

## References

[TwoMoons](https://github.com/moayuisuda/two-moons) is the original upstream product reference for associating guitar fingering with playable pitches. Its upstream license is GPL-3.0. The local reference checkout was the [kyn0v/two-moons](https://github.com/kyn0v/two-moons) fork. Primary attribution belongs to the original upstream.

Tele uses TwoMoons only as a reference. It imports or copies none of its source, audio samples, or other assets. This project's HTML, CSS, diagrams, and synthesis are independent implementations. See [third-party notices](THIRD_PARTY_NOTICES.md). Tele's source is licensed under the [MIT License](LICENSE), copyright 2026 Jian. Third-party licenses remain unchanged.
