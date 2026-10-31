# Continue a live Pi conversation beside the board

[English README](../README.md) | [简体中文 README](../README.zh-CN.md) | [中文对话参考](chat-reference.md)

## Goal and scope

The user can open a conversation panel on the existing listening page, see prior messages, type followups and watch the same agent update the board. The panel docks right by default, or left/bottom, and collapses without losing the draft. This deliberately supersedes the original no-chat UI boundary while retaining the existing agent as the conversation owner.

## Proven runtime boundary

Pi1.2.0 RPC starts a separate process. It has no attach-to-live-CLI command. Opening one session file in two Pi processes is not attachment and is unsafe. The selected integration is a trusted Pi extension inside the existing process; it neither creates another AgentSession nor enumerates session files.

The extension reads original active-branch entries with ctx.sessionManager.getBranch(), including pre-compaction history. Compacted model context differs from original display history. It sends literal messages through pi.sendUserMessage and observes lifecycle events. That method and ctx.abort return void; HTTP submission does not imply model acceptance or completion. agent_settled is the final run boundary.

## Caller experience

Install dependencies and build browser assets, load the project-local extension in the existing trusted Pi, then activate while idle:

```sh
npm ci
npm run build
```

In the already-running trusted Pi, after active work finishes:

```text
/reload
/tele conversation
```

The Pi commands are not shell commands. Explicit loading on a new Pi launch is also supported with `pi -e /absolute/path/Tele/.pi/extensions/tele.js`, or `pi -e /absolute/path/Tele/dist/pi-extension.js` after a build. Do not open an active CLI session file in another writer. No global Pi configuration is changed by the feature.

The extension lazily starts the existing Tele HTTP server in the same process and associates one board with its current Pi session. If the standalone server already owns that data directory/port, show a clear handover instruction; never kill an unknown process. One-time handover avoids a relay protocol. The activation command opens a short-lived, single-use pairing URL without putting secrets into model-visible messages. Browser refresh may retain its scoped authentication, but unauthenticated ordinary board URLs never reveal chat history.

`/tele off` revokes browser control and releases extension-owned resources, without killing Pi or deleting history. Session replacement and runtime shutdown invalidate the binding. Reconnection must be explicit after a different session is selected, not silently expose the new session under an old grant.

## Ownership and shape

Pi is the sole transcript writer. Existing BoardStore remains the sole board writer. Browser holds only an authenticated display projection and draft/preferences. No second transcript database.

`src/chat-schema.ts` defines strict Zod schemas and derives `ChatItem`, `ChatView`, and `ChatCommand` from them. `ChatItem.role` discriminates four variants. User and assistant items contain `text`. Tool items contain a bounded `name` and `status`. Notice items contain a stable `code`. `ChatView.notice` is a stable submission/lifecycle code or `null`, not display prose. Raw tool payloads remain private. [The conversation reference](chat-reference.md) lists exact codes and bounds.

- `src/chat-schema.ts` owns bounded public projection/command schemas, used at the browser boundary.
- `src/chat-server.ts` owns invitation/cookie authorization, private HTTP/SSE adaptation and limits, without Pi imports.
- `src/pi-extension.ts` owns session projection, events, admission/receipts, Pi injection/abort, optional server lifecycle and board tools.
- `src/chat-web.ts` owns panel DOM, network connection and UI preferences; no raw Pi wire records reach it.
- `src/server.ts` gains an optional chat adapter and an explicit public capability indicator saying chat is available, without exposing session identity/history. Existing board routes and standalone mode keep working.

Equivalent small splits are allowed if ownership remains clear. Avoid pass-through client layers or a generic multi-agent framework.

## History, command and lifecycle contracts

Display active-branch user/assistant text, compaction notices and tool names/status. Exclude thinking, system prompts, provider credentials, raw tool arguments/results and abandoned branches. Keep a bounded projection (e.g.100 messages and256KiB) and label omitted/truncated history. The real Pi history is untouched. Streaming uses disposable live items; resync finalized history after turn_end/agent_settled, not synchronously in message_end before persistence. Coalesce notifications rather than blocking each Pi token on socket I/O.

Subscribe before initial snapshot; monotone projection sequence/epoch protects reconnect. Browser reconnects to a fresh snapshot, never replays a send automatically. Bound stream count and backpressure. Chat re-render never triggers board audio stopping or replaces the composer DOM during input.

Reserve one browser send synchronously, check current context is idle with no pending messages, then inject literal text with expandPromptTemplates:false. Reject busy/disconnected/stale requests and retain draft. Use unique IDs and bounded receipt deduplication so retries cannot duplicate messages; an ambiguous missing observation is explicitly unknown, never silently retried. Reconcile actual user/agent events; do not promise unconditional acceptance from void dispatch. Provider errors and consumed/failed submissions must release pending admission and display errors, not hang forever. Expose Abort while work is active; confirm stopped only from actual lifecycle. Do not automatically re-send queued terminal input or claim abort undoes already-committed board changes.

## Agent tools and terminal boundary

Provide a model-callable board tool with catalogue/get/put actions bound to the attached board. Use existing ContentSchema and revision checks. Do not expose capability tokens in arguments, results or prompt. Never modify application source to change teaching content.

While explicitly attached, use a clearly labeled music-control mode with only the bound board tool allowed for model tool calls. Remember and restore the previous tool loadout when detached. Enforce at tool_call as well as declarations, without bypassing other extensions' existing permission hooks. The UI and activation notice must state this temporary mode. Do not suppress or fake actual user messages from the terminal. Busy admission and Pi's own single-owner runtime handle both clients; browser does not lock out the CLI wholesale.

Pi's live extension APIs cannot generally answer another extension's terminal dialogs. ui_prompt_start/end only expose kind/title. Show terminal-required state, disable new browser sends, offer abort, and clearly say a terminal action may be required. Do not auto-confirm, claim a resolver exists, or hide indefinite waits. Plain music discussion and our board tool require no dialogs. Managed RPC for richer dialog handling is deferred, not masqueraded as attachment.

## Browser security

Chat history and all commands are private even when board reads remain public. Generate a short-lived one-use pairing secret from the local Pi command; prefer URL fragment erased immediately and exchanged via same-origin POST. Issue an expiring HttpOnly SameSite=Strict cookie scoped to an opaque board/session binding. Browser storage retains only nonsecret binding identity, dock/collapse preferences, and `tele.locale`, never the board-write token. No anonymous session listing, arbitrary file selection or public token mint endpoint.

Keep loopback binding, Host/Origin/Fetch-Metadata checks and CSP. Require exact same-origin JSON mutations. Authenticate history, status, SSE, send, abort and disconnect. Revoke grants on detach/reload/session replacement. Reject expired/cross-board/stale epochs. Never log pairing/session tokens, credentials or private chat text as server diagnostics. Render messages as text, not HTML.

## Layout

Keep the existing warm-paper visual style. Panel has a clear session label, collapse button, position selector, readable scrollable history, streaming/tool status, labeled textarea, Send and Abort. Enter submits, Shift+Enter inserts a newline; IME composition must not submit accidentally. Preserve draft/focus when docking and incoming events arrive. Auto-scroll only if already near the bottom.

Use container-aware board responsiveness: a400px panel on a1440px screen leaves1040px content even though viewport is still1440. Do not shrink three diagrams into unreadable cards. Narrow screens use a sensible bottom layout without overwriting the stored desktop preference.

## English and Simplified Chinese

`src/i18n.ts` owns the canonical English dictionary, a structurally checked Simplified Chinese dictionary, parameter functions, and locale preference logic. Schema-derived types require every phase, history notice, tool status, and lifecycle notice to have a translation. `src/locale-web.ts` connects that preference to the browser. No i18n framework or dependency was added.

The header selector is outside the chat panel. It updates `html.lang` and the document title. A saved `tele.locale` choice wins over the primary navigator language. `zh*` maps to `zh-CN`; other languages map to `en`. Invalid stored values follow the navigator rule. Failed storage reads or writes do not prevent selection.

A locale change updates generated text and accessibility attributes on existing nodes. It does not call `apply`, send a command, replace the composer, render a board snapshot, or stop or start audio. Chat history updates generated roles, tool status, and notice labels without touching plain message text. Board controls and diagrams update labels without replacing chord nodes or cancellation handles. User content and session names are never translated, even when they equal old generated Chinese prose.

This changes the ephemeral chat wire projection. It is not a board migration and does not rewrite persisted Pi entries. Old text-only tool/notice items and prose-valued `ChatView.notice` are rejected by the current strict schema. There is no legacy compatibility alias. Reload the browser after updating the extension. The private revocation registry and authorization protocol are unchanged.

The no-model Pi/browser probe verifies both locales, primary-language fallback, saved choice, invalid preference and blocked storage, visible and accessible generated labels, unchanged original Pi messages and board snapshots, retained composer node/focus/selection, all docks and collapse modes, and phone width. The production browser/audio suite verifies a language switch during active playback retains the existing context and Stop handle. Screenshots for both languages are local `.audit/chat/probe-en-*.png` and `.audit/chat/probe-zh-CN-*.png` artifacts. The paid model verifier sets an explicit initial Chinese locale and permits the new storage key; it is not part of the no-model implementation proof.

## Synthesis

All four candidates favor a live extension with the existing server hosted in-process. Candidate one is the base for concrete invitation lifecycle and same-session ownership. Graft candidate two's explicit submission uncertainty/history bounds, candidate three's event-persistence warning and IME/container handling, and candidate four's smallest command/status model. Reject managed RPC as the primary path because it starts a different owner. Reject external relay to avoid a second delivery/ack/lease protocol. Reject candidates' blanket terminal-input lockout as unnecessary: retain Pi ownership and refuse busy browser submissions instead.

Scores (continuity/usability/security/lifecycle/simplicity/proof, each0–2): one12, two11 (extra history paging/client abstraction), three11 (terminal lockout), four10 (less precise acknowledgement/stale semantics). Cross-family judge unavailable: configured pool and parent are GPT variants. Independent implementation/security review remains mandatory.

## Implementation reconciliation and proof

The implementation follows this shape. `src/pi-chat.ts` owns the run and submission state, while `src/chat-history.ts` owns bounded Pi projection. `src/http.ts` shares the existing bounded JSON reader with the private adapter. The server exposes `getBoard` and one commit-and-publish `putBoard` path to the extension, so tool edits and HTTP edits use the same revision and SSE behavior.

The project discovery wrapper is `.pi/extensions/tele.js`. It imports `src/pi-extension.ts` through Pi's TypeScript loader, so a checkout with dependencies can load the extension without generated `dist` files. Browser assets still require a build. The built `dist/pi-extension.js` remains an explicit `-e` entrypoint after building. Use one entrypoint per process. Pi and TypeBox are host peers with pinned development copies; shipped code has no absolute global imports. The extension adds `--tele-port` and `--tele-data` for isolated use and verification.

The command schema adds `idleVersion` to reject delayed sends after intervening runs. Its bounded request ledger retains every accepted ID for the connection rather than evicting IDs that could be replayed. Unknown void submissions require terminal inspection; they are never automatically resubmitted. Actual final branch entries recheck a provisional message observation. Abort IDs are created only on actual `agent_start` events and change at each such boundary, rather than treating a send reservation as an abortable run.

A real no-model probe also exercises an input suspended inside another extension after Pi reports idle. A process-local `AsyncLocalStorage` dispatch marker survives reload and is revoked on detach. A late revoked submission is aborted before provider work, and its tool calls remain blocked even after the terminal loadout has been restored. The private global registry key `__audioharnessDispatchV1` intentionally retains its identity across the Tele rename. Changing it during a live Pi reload would lose cancellation of old suspended input. It is not a public API alias, a prompt token, or a persisted transcript.

Pi may populate optional tool fields even for a read action. The bound tool therefore accepts declared write fields on `get` and `catalogue`, then discards those unused fields. The `put` branch retains strict content and revision validation. A real model run exposed this incompatibility, and the suite now includes that input shape.

The single tool name is `tele_board`, with no namespace and `model-only` exposure. Both declarations and the tool-call gate restrict attached runs. Terminal text remains available. Branch navigation revokes the binding as well as session replacement, avoiding silent changes in the selected history. `off` revokes access immediately, then waits for safe settlement before restoring the previous tool set.

Desktop docking, mobile bottom layout, collapse state, draft preservation and container-aware chords are implemented without a framework. Only nonsecret binding identity, layout preferences, and locale are stored. Drafts are not persisted through page reload. [The reference](chat-reference.md) records exact limits and failure behavior.

Verification first exercised extension activation, original history and consumed submission without model work. A later real model preview used configured credentials and only the bound board tool. No global auth/config edits or unrelated transcript reads were needed.

The original 11 tests, build and browser-audio suite remain green. The expanded suite covers private cookies, expiry, epoch revocation, original branch filtering, request bounds and stale aborts. The repeatable no-model probe exercises real Pi UI wait events and tool restoration. A three-prompt preview using the configured `github-copilot/gpt-6-luna` model demonstrated earlier conversation recall, streamed browser output, autonomous get/put of the same board, persistent Pi history and browser abort. This was a separate test Pi, not the parent's live session. Browser checks cover docking, collapse persistence, IME, preserved composer identity, reading position and mobile layout. Independent execution/history privacy and ownership review remains the parent's gate. Source changes remain local, with no remote PR or deployment.
