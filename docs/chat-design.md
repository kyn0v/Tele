# Continue a live Pi conversation beside the board

## Goal and scope

The user can open a conversation panel on the existing listening page, see prior messages, type followups and watch the same agent update the board. The panel docks right by default, or left/bottom, and collapses without losing the draft. This deliberately supersedes the original no-chat UI boundary while retaining the existing agent as the conversation owner.

## Proven runtime boundary

Pi1.2.0 RPC starts a separate process. It has no attach-to-live-CLI command. Opening one session file in two Pi processes is not attachment and is unsafe. The selected integration is a trusted Pi extension inside the existing process; it neither creates another AgentSession nor enumerates session files.

The extension reads original active-branch entries with ctx.sessionManager.getBranch(), including pre-compaction history. Compacted model context differs from original display history. It sends literal messages through pi.sendUserMessage and observes lifecycle events. That method and ctx.abort return void; HTTP submission does not imply model acceptance or completion. agent_settled is the final run boundary.

## Caller experience

Build the project, load its project-local extension in the existing trusted Pi, then activate while idle:

```sh
npm install
npm run build
# In the already-running trusted Pi, after active work finishes:
/reload
/audioharness conversation
```

A command is not a shell command. The README must distinguish these steps. Explicit loading on a new Pi launch is also supported with `pi -e /absolute/AudioHarness/dist/pi-extension.js`, but must not open an active CLI session file in another writer. No global Pi configuration is changed by the feature.

The extension lazily starts the existing AudioHarness HTTP server in the same process and associates one board with its current Pi session. If the standalone server already owns that data directory/port, show a clear handover instruction; never kill an unknown process. One-time handover avoids a relay protocol. The activation command opens a short-lived, single-use pairing URL without putting secrets into model-visible messages. Browser refresh may retain its scoped authentication, but unauthenticated ordinary board URLs never reveal chat history.

`/audioharness off` revokes browser control and releases extension-owned resources, without killing Pi or deleting history. Session replacement and runtime shutdown invalidate the binding. Reconnection must be explicit after a different session is selected, not silently expose the new session under an old grant.

## Ownership and shape

Pi is the sole transcript writer. Existing BoardStore remains the sole board writer. Browser holds only an authenticated display projection and draft/preferences. No second transcript database.

Illustrative signatures, to be implemented with inferred strict schemas rather than duplicated handwritten wire types:

```ts
type ChatItem = { id: string; role: 'user' | 'assistant' | 'tool' | 'notice'; text: string };
type ChatPhase = 'idle' | 'submitted' | 'busy' | 'stopping' | 'terminal-required' | 'disconnected';
type ChatView = { binding: string; epoch: string; sequence: number; boardId: BoardId;
  sessionLabel: string; phase: ChatPhase; items: ChatItem[]; truncated: boolean };
type ChatCommand = { kind: 'send'; id: string; epoch: string; text: string }
  | { kind: 'abort'; id: string; epoch: string; runId: string };
interface ChatAdapter {
  snapshot(): ChatView;
  subscribe(listener: (view: ChatView) => void): () => void;
  submit(command: ChatCommand): Receipt;
  close(): void;
}
```

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

Chat history and all commands are private even when board reads remain public. Generate a short-lived one-use pairing secret from the local Pi command; prefer URL fragment erased immediately and exchanged via same-origin POST. Issue an expiring HttpOnly SameSite=Strict cookie scoped to an opaque board/session binding. Browser storage retains only nonsecret binding identity and dock/collapse preferences, never the board-write token. No anonymous session listing, arbitrary file selection or public token mint endpoint.

Keep loopback binding, Host/Origin/Fetch-Metadata checks and CSP. Require exact same-origin JSON mutations. Authenticate history, status, SSE, send, abort and disconnect. Revoke grants on detach/reload/session replacement. Reject expired/cross-board/stale epochs. Never log pairing/session tokens, credentials or private chat text as server diagnostics. Render messages as text, not HTML.

## Layout

Keep the existing warm-paper visual style. Panel has a clear session label, collapse button, position selector, readable scrollable history, streaming/tool status, labeled textarea, Send and Abort. Enter submits, Shift+Enter inserts a newline; IME composition must not submit accidentally. Preserve draft/focus when docking and incoming events arrive. Auto-scroll only if already near the bottom.

Use container-aware board responsiveness: a400px panel on a1440px screen leaves1040px content even though viewport is still1440. Do not shrink three diagrams into unreadable cards. Narrow screens use a sensible bottom layout without overwriting the stored desktop preference.

## Synthesis

All four candidates favor a live extension with the existing server hosted in-process. Candidate one is the base for concrete invitation lifecycle and same-session ownership. Graft candidate two's explicit submission uncertainty/history bounds, candidate three's event-persistence warning and IME/container handling, and candidate four's smallest command/status model. Reject managed RPC as the primary path because it starts a different owner. Reject external relay to avoid a second delivery/ack/lease protocol. Reject candidates' blanket terminal-input lockout as unnecessary: retain Pi ownership and refuse busy browser submissions instead.

Scores (continuity/usability/security/lifecycle/simplicity/proof, each0–2): one12, two11 (extra history paging/client abstraction), three11 (terminal lockout), four10 (less precise acknowledgement/stale semantics). Cross-family judge unavailable: configured pool and parent are GPT variants. Independent implementation/security review remains mandatory.

## Implementation reconciliation and proof

Main owner accepts the above shape. Document substantive deviations here. No implementation has been claimed yet.

First prove extension activation/history/injection without model work. Then run a bounded real Pi model test using configured credentials and only the safe board tool: prior conversation, pair browser, send a followup that depends on earlier text, stream response, real board update, another followup and abort where feasible. Don't claim mock events prove Pi integration. No global auth edits or unrelated transcript reads.

Keep current11 tests/build/browser-audio suite green. Add authorization, cross-site, deduplication, busy/stale/unknown, lifecycle revocation and terminal-required tests. Drive right/left/bottom/collapse/persistence/IME/mobile in real browser and inspect screenshots. Independent review must assess execution/history privacy and ownership. Source changes remain local, no remote PR/deployment.
