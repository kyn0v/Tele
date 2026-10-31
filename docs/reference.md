# Tele board POC reference

## Content document

A PUT body is a complete content document. Unknown fields are rejected at every object level. Text is trimmed. Array order is presentation and playback order.

```json
{
  "title": "同一个 D，不同的回家路",
  "description": "教学示例，不是已核实的歌曲转录。",
  "tempo": 90,
  "groups": [
    { "id": "major", "title": "大四级", "chords": ["D", "G", "D"] }
  ]
}
```

| Field | Contract |
| --- | --- |
| `title` | Required string, 1 to 120 UTF-16 code units after trimming. |
| `description` | Optional string, at most 1200 code units after trimming. |
| `tempo` | Integer 40 to 200 BPM. Defaults to 90. One chord lasts two beats. |
| `groups` | 1 to 12 ordered groups. |
| Group `id` | 1 to 48 lowercase ASCII letters, digits or hyphens. First character must be a letter or digit. Unique within this document. |
| Group `title`, `description` | Same text bounds as the content title and description. |
| Group `chords` | 1 to 32 catalogue symbols in order. Duplicates are allowed. |

Supported symbols are D, G, Gm, Em, A, C, Am, F, Bm, A7, Dm, E, E7, G7. Symbols are case-sensitive. Each symbol has one fixed standard-tuning voicing. There is no capo or alternate tuning.

## HTTP

The server binds only `127.0.0.1`. Its default address is `http://127.0.0.1:4317`. All API responses use JSON except SSE.

### GET /api/catalogue

Returns `tuning`, `stringOrder` and `chords`. Every chord contains `symbol`, `frets`, `startFret` and `strings`. Frets and string entries run from low E to high E. A null fret is muted, zero is open. Each string entry contains `fret`, `midi` and displayed `pitch`. Muted strings have null MIDI and `×` pitch. MIDI open tuning is `[40,45,50,55,59,64]`.

The diagram, note labels and audio derive from these same canonical frets. D is `xx0232`, with MIDI notes `[50,57,62,66]`. Gm is `355333`, with notes `[43,50,55,58,62,67]`. Gm's viewport starts at fret 3. Viewport offset is not a capo.

### GET /api/boards/:id

Returns `{id, revision, content}` and a quoted numeric `ETag`. Missing boards return 404. Board IDs use the same format as group IDs.

### PUT /api/boards/:id

Requires these headers:

```http
Authorization: Bearer <local capability>
Content-Type: application/json
If-Match: "0"
```

`If-Match` must be exactly one quoted nonnegative integer. Zero means create only. An existing board requires its exact current revision. Weak ETags, lists, wildcards, unquoted values and missing preconditions are rejected.

A successful create returns 201. A replacement returns 200. Both return `{id, revision, content, url}` and the new `ETag`. The stable URL is `/b/:id`. Every accepted PUT increments the revision, including identical content. Revision zero is never persisted. Revisions are bounded by `Number.MAX_SAFE_INTEGER - 1`.

A stale expected revision returns 409 and `{error, currentRevision}`. No state changes. Clients must get the latest board, reconcile their desired replacement, then retry with its revision. There is no automatic conflict retry or merge.

### GET /api/boards/:id/events

Missing boards return 404. Otherwise the response is `text/event-stream`. The stream immediately sends the current full snapshot and then every committed full snapshot. An event looks like this:

```text
id: 2
event: snapshot
data: {"id":"harmony","revision":2,"content":{"title":"Example","tempo":90,"groups":[{"id":"a","title":"A","chords":["D"]}]}}

```

Initial snapshot lookup and subscriber registration run in the same synchronous turn. A commit cannot fall between them. The service sends heartbeat comments every 15 seconds. Reconnection receives the current snapshot, not an event replay. `Last-Event-ID` does not select history.

The browser applies only a newer revision. It stops all current and scheduled playback on replacement and preserves group or chord-button focus where that button still exists. Reconnection never autoplays. A page returned from the browser back-forward cache reloads to restore a fresh stream.

### Error status codes

| Status | Meaning |
| --- | --- |
| 400 | Malformed JSON, invalid ID, schema violation or invalid precondition. |
| 401 | Missing or invalid local write capability. |
| 403 | Invalid Host, foreign Origin or cross-site request. |
| 404 | Unknown board, route or asset. |
| 405 | Unsupported method on a known board route. |
| 409 | Expected revision differs from the current revision. |
| 413 | Request exceeds 65,536 bytes, including streamed bodies. |
| 415 | PUT does not use `application/json`. |
| 428 | Missing `If-Match`. |
| 429 | More than 16 concurrent SSE streams for a board. |
| 500 | Filesystem or unexpected server failure. No uncommitted snapshot is published. |
| 503 | Server is stopping. |
| 507 | Board capacity or revision limit reached. |

There is no permissive CORS response. Host is restricted to `127.0.0.1:<port>` or `localhost:<port>`. An Origin, when present, must equal `http://<Host>`. Null Origins are rejected. Cross-site requests are rejected except GET document navigations to `/` or a valid `/b/:id` URL. API requests, subresources, and iframe navigations receive no exception. Host, Origin, and write-capability checks still apply. Browser writes are not part of this POC.

## Persistence and ownership

`TELE_DATA` selects a directory. The default is `.data` beside the project, resolved relative to the installed modules rather than the process working directory. `TELE_PORT` is an integer 1 to 65535 and defaults to 4317. Test code may pass port zero directly to `startServer`.

The directory contains:

- `boards/<id>.json` contains the complete committed snapshot.
- `capability` contains a randomly generated 256-bit write token. Creation mode is 0600.
- `server.lock/owner.json` records PID and startup time for the single owning server.

Directory creation mode is 0700. Existing directory permissions are not rewritten. Existing stored boards are validated at startup. Corrupt or oversized snapshots make startup fail instead of silently discarding data. At most 128 boards can exist, including the seeded `demo` board. There is no delete endpoint.

Lock acquisition uses an exclusive directory creation after resolving the data directory's real path. A second server cannot share this directory, even on another port. Stale locks fail explicitly. The operator must confirm the old owner is gone before removing a stale lock. No PID-based recovery occurs automatically.

Each PUT checks revision, writes a same-directory temporary file, fsyncs and closes that file, atomically renames it, then updates memory and publishes SSE. This bounded commit is synchronous to prevent overlapping writer races in this single Node process. It may briefly block other requests. It is not a database or a distributed-writer protocol.

This promises normal process-restart persistence and atomic replacement on a local filesystem. It does not promise power-loss durability, filesystem-failure recovery, network-filesystem semantics or protection from other local OS processes editing files. An interrupted write can leave a `.tmp` file, which startup ignores. Successful board state is never loaded from a temporary file.

SIGINT and SIGTERM end SSE streams and stop the HTTP server before releasing the data lock. Remaining HTTP connections are force-closed after one second during shutdown. Abrupt termination leaves the lock. The browser has no capability token. Static serving exposes only `/assets/web.js`, `/assets/audio.js`, `/assets/style.css`, `/favicon.svg`, and board HTML routes. The POC trusts local OS processes and is not safe for public deployment.

## Browser audio and build modules

`src/audio.ts` exports `scheduleChord(context: BaseAudioContext, notes: readonly number[], at: number)`. It returns start and end times, a `finished` promise resolved by oscillator end events, and a cancellable `stop` function. The browser retains cancellation handles until all voices finish on the audio clock. Stop disconnects output immediately and cancels oscillators at the current audio time, including while suspended, so resuming cannot play an obsolete tail. Both `AudioContext` and `OfflineAudioContext` are supported. Additive sine partials with decaying envelopes and a short string-by-string offset approximate a pluck. This is original synthesis, not sampled guitar audio.

The project-local `.pi/extensions/tele.js` imports `src/pi-extension.ts` through Pi's TypeScript loader and can load with dependencies installed before `dist` exists. Browser assets and standalone CLI entrypoints still require a build. After building, `pi -e /absolute/path/Tele/dist/pi-extension.js` remains a supported explicit extension entrypoint. Do not load both entrypoints in one Pi process.

`npm run build` emits a standalone ESM module at `dist/public/assets/audio.js`, served as `/assets/audio.js`. Browser automation can import that module directly. There is no test-only global API. `web.js` contains its own bundled copy of the same source implementation.

## Source discovery proof

Commit `f9282ceb591f048175a1d439b3d3bf3bbfd24102` was checked out into a new detached temporary worktree. The exact sequence was `test ! -e dist`, `npm ci`, `test ! -e dist`, `npm run verify:extension`, then `test ! -e dist`. All commands succeeded, and the checkout had no tracked changes.

The probe launched the pinned Pi 1.2.0 runtime with project trust for that process, isolated temporary configuration and data, offline mode, and no persisted session. It passed no `-e` flag and submitted only the `get_commands` RPC query, not a model prompt. Pi reported `/tele` from automatic project discovery of `.pi/extensions/tele.js`:

```json
{
  "distAbsent": true,
  "explicitExtensionFlag": false,
  "command": "tele",
  "source": "auto",
  "scope": "project",
  "status": 0
}
```

The delegate worktree also passed `npm test` with 18 tests, `npm run build`, `npm run verify:chat:probe`, and `npm run verify:browser`. The chat probe recorded zero provider requests and confirmed revoked suspended input cannot reach provider work. Browser checks covered production CLI updates, audio cancellation, keyboard interaction, reconnect, and desktop and mobile layouts. No paid model verification ran for the rename. These checks do not replace independent review or subjective listening.

## Verification artifacts

`npm test` runs Node's test runner through the project-local `tsx` dependency. Tests use actual loopback HTTP services, temporary directories and CLI child processes.

`npm run verify:browser` requires the production build and Playwright's Chromium headless shell. It creates its own data directory and port, runs production CLI commands from outside the repository, drives Chromium, saves desktop and mobile screenshots, renders production synthesis to mono 48 kHz WAV, checks finite nonzero samples below full scale, checks reconnect after restart, then cleans up its own service and data. Its output is under `.audit/browser/`. Audio sample checks and AudioContext activation are not subjective speaker verification. Independent review remains a separate delivery gate.
