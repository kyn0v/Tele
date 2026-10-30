# AudioHarness POC design

## Problem

An existing agent needs to turn a music-theory explanation into ordered guitar diagrams that the user can hear, and update that same browser page on later turns. The target is a new local repository. TwoMoons is a reference for controlled guitar diagrams and pitch-based browser playback, not an agent integration to import.

## Usage

```sh
npm install
npm run build
npm start
# Local service at http://127.0.0.1:4317

npm run board -- put harmony --expect 0 --file examples/major.json --open
npm run board -- get harmony
npm run board -- put harmony --expect 1 --file examples/comparison.json
npm run board -- catalogue
```

The first put creates a board, returns its revision and stable `/b/harmony` URL, and optionally opens it with the operating system browser. The second put replaces the complete board document at the expected revision. The already-open page receives the updated snapshot. Agent interfaces are CLI and HTTP; no MCP adapter or embedded chat is needed for this POC.

## Shape

The authoritative content is an ordered board document. Groups own ordered chord symbols rather than references to mutable shared favorites. A finite catalogue owns standard-tuning guitar voicings. Diagram marks, displayed sounding notes and audio all derive from those voicings.

```ts
type Frets = readonly [number | null, number | null, number | null,
                      number | null, number | null, number | null];
type ChordSymbol = keyof typeof catalogue;
type Group = { id: string; title: string; description?: string; chords: ChordSymbol[] };
type Content = { title: string; description?: string; tempo: number; groups: Group[] };
type Board = { id: string; revision: number; content: Content };

parseContent(input: unknown): Content;
notesFor(symbol: ChordSymbol): readonly number[];
get(id: BoardId): Board | undefined;
put(id: BoardId, expected: Revision, content: Content): Board;
scheduleChord(context: BaseAudioContext, notes: readonly number[], at: number): Playback;
```

These are a sketch, not declarations to duplicate. Runtime schemas derive exported types. Validate at HTTP, stored-file, CLI and browser boundaries. Use standard MIDI tuning `[40,45,50,55,59,64]`, strings low E to high E, null muted, zero open. Show correct chord-tone spelling where practical, especially D's F♯ and Gm's B♭. No capo, alternate tuning or arbitrary fingering editing in version one.

- `src/music.ts` owns the supported chord catalogue, fingering and pitch derivation.
- `src/boards.ts` owns schema, revisions and persistence. One server owns all writes, with bounded synchronous commits or per-board serialization. A persistence failure must not change in-memory content or publish an update.
- `src/server.ts` owns loopback HTTP, static content, request limits, authentication and SSE.
- `src/cli.ts` translates command arguments and JSON into the HTTP interface, never writes board files.
- `src/web.ts`, `src/style.css`, `src/audio.ts` own browser rendering, playback state and original Web Audio plucked synthesis.

Use Node and browser APIs, TypeScript with a small bundler, and a runtime schema library if it reduces handwritten validators. No frontend framework is required for this small read-only board. Bound IDs, text, groups, chord counts and request size. Reject unknown fields and unknown chords explicitly.

## State and security contracts

`GET /api/boards/:id` reads a board. `PUT /api/boards/:id` replaces with a required numeric expected revision, zero meaning create only; return 409 on stale writes. Expose the revision consistently via the documented request contract. Full-document replacement can change ordering, replace a chord or add a comparison without additional mutation verbs. Identical content at the current revision may be a no-op if documented and tested. The HTTP catalogue advertises supported input.

`GET /api/boards/:id/events` sends an immediate current snapshot then later committed snapshots. Registration and initial snapshot must not have a missed-update window. Browser applies only newer revisions, stops ongoing playback on replacement, reconnects to current state and never autoplays on updates. Show actual connection status.

Persist per-board JSON locally with atomic replacement. Promise restart persistence, not distributed writes or power-loss durability. Reject a second active server using the same data directory; do not silently permit two writers on different ports. Document lifecycle behavior.

Bind to `127.0.0.1`; validate Host, reject foreign mutation Origins, no permissive CORS. Mutations require a locally stored random capability token readable by the CLI, never sent to browser JavaScript. Use textContent/DOM text rendering, safe IDs and restricted static asset serving. The POC trusts local OS processes and is not intended for public deployment.

## Listening interface

Chinese-first, warm paper background, clear dark type, restrained teal and contrasting comparison accent. Large readable chord cards show standard vertical chord-box diagrams, mute/open string markers, starting fret and sounding pitches. Each card is keyboard playable. Each group has play and the page has stop. Show active chord and short update feedback, not JSON controls. Cards should remain legible on mobile. On `/`, provide an inviting starter/demo board or links to existing boards rather than an empty technical page.

First demo is D → G → D with a followup adding D → Gm → D. Label these 大四级 and 小四级, not 原版 versus 改版; this is a teaching example, not verified song transcription. Another example is Em → A → D. Sound is explicitly labeled 合成拨弦, with no guitar-recording fidelity claim. AudioContext starts/resumes only on user gesture. Production synthesis must accept OfflineAudioContext for objective audio tests.

## Synthesis decision

Four isolated candidate designs compared server-owned snapshots/SSE against direct file writes/polling. All recommended server ownership. Candidate two is the base because a single put with expected revision covers create and all followups without redundant create/append/replace APIs. Candidate one contributes identical-update semantics and correct note spelling. Candidate three contributes explicit initial snapshot ordering and stopping playback on document change. Candidate four contributes using the production synthesis function for offline audio proof. Reject append-only API because users also need replacing and reordering.

Scores by criterion (agent usage, music integrity, state correctness, local deployment, observable experience, maintenance; each 0–2): candidate one 2/2/2/2/2/1 = 11; two 2/2/2/2/2/2 = 12; three 2/2/2/2/2/1 = 11; four 1/2/2/2/2/1 = 10. The configured pool resolves entirely to GPT models; cross-family judge skipped rather than claiming cross-family diversity. Independent implementation review remains required.

## Tradeoffs

We accept one running local service in exchange for stable URLs and conflict-safe updates. We accept a bounded chord catalogue, standard tuning and synthesized plucks for a small honest POC. We choose a structured listening board rather than a general canvas. Under Experience First, user-facing listening comes before integration configuration. Under Model the Domain, one voicing is the source of both picture and sound.

## Implementation reconciliation

The main agent accepted this design before implementation. The implementation uses `src/schema.ts` for shared Zod schemas and `src/config.ts` for module-relative data paths. `src/boards.ts` owns synchronous persistence and exclusive data-directory locking. These are compatible module splits, not architecture changes.

PUT requires a quoted numeric `If-Match` header. Every accepted PUT increments the revision, including identical content. `/` redirects to the seeded `demo` board with both comparisons. The production synthesis is also emitted as standalone `/assets/audio.js`.

`Playback` includes a `finished` promise resolved by oscillator end events. Browser completion follows that promise rather than a wall timer, retaining cancellation handles while the audio clock is suspended. Stop disconnects output immediately, so an update during suspension cannot leave a stale tail on resume. This is a compatible extension of the synthesis contract. Cross-site GET document navigation is allowed only for root and valid board URLs, so agent-chat links work without opening API or subresource access. Exact limits and lifecycle behavior are recorded in [the API reference](reference.md).

## Verification

Build and test music fixtures and real HTTP behavior, including conflicts, invalid payloads, oversized input, state isolation and restart. Drive browser creation/click/live update through real commands. Test production synthesis via OfflineAudioContext for finite nonzero samples, without claiming subjective speaker audition. Inspect keyboard interaction, desktop/mobile layouts, connection loss, screenshots and console errors.

## Implementation status

The catalogue, conflict-safe HTTP service, browser diagrams, shared synthesis and agent CLI are implemented. The repository includes real HTTP tests and a reproducible production-browser verification script. Independent implementation review remains the parent agent's delivery gate.
