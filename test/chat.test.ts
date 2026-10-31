import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { BoardCommandSchema } from '../src/pi-extension.js';
import { HttpError, json } from '../src/http.js';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { PiChat } from '../src/pi-chat.js';
import { branchHistory } from '../src/chat-history.js';
import { BindingSchema, ChatViewSchema, type ChatAdapter, type ChatCommand, type ChatView } from '../src/chat-schema.js';
import { BoardIdSchema } from '../src/schema.js';
import { startServer } from '../src/server.js';
import { createChatAccess } from '../src/chat-server.js';

const boardId = BoardIdSchema.parse('private');
function runtime() {
  const sessionManager = SessionManager.inMemory();
  let idle = true; let pending = false; let aborts = 0;
  const calls: { text: unknown; options: unknown }[] = [];
  const ctx = { sessionManager, isIdle: () => idle, hasPendingMessages: () => pending, abort: () => { aborts++; } };
  const chat = new PiChat(boardId, ctx, { sendUserMessage(text, options) { calls.push({ text, options }); } }, 20);
  const send = (text = 'Music question'): Extract<ChatCommand, { kind: 'send' }> => ({ kind: 'send', id: randomUUID(), epoch: chat.epoch, idleVersion: chat.snapshot().idleVersion, text });
  return { chat, ctx, calls, send, setIdle: (value: boolean) => { idle = value; }, setPending: (value: boolean) => { pending = value; }, aborts: () => aborts };
}

test('admission reserves once, binds IDs to content, handles busy/pending/stale and literal input', () => {
  const { chat, ctx, calls, send, setIdle, setPending } = runtime();
  setIdle(false); assert.throws(() => chat.submit(send()), /busy/); setIdle(true);
  setPending(true); assert.throws(() => chat.submit(send()), /busy/); setPending(false);
  assert.throws(() => chat.submit(send('/tele off')), /not slash/);
  const command = send(); const receipt = chat.submit(command);
  assert.equal(receipt.status, 'submitted');
  assert.equal(chat.snapshot().runId, null, 'A send reservation is not an abortable run');
  assert.deepEqual(chat.submit(command), receipt); assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]?.options, { expandPromptTemplates: false });
  assert.throws(() => chat.submit({ ...command, kind: 'send', text: 'Different' }), /different content/);
  assert.throws(() => chat.submit(send()), /busy/);
  assert.throws(() => chat.submit({ ...command, id: randomUUID() }), /State changed/);
  chat.message({ role: 'user', content: 'Unrelated terminal input', timestamp: 1 }, true);
  assert.equal(chat.snapshot().submission?.state, 'submitted');
  const user = { role: 'user', content: 'Music question', timestamp: 2 } as const;
  chat.message(user, true); ctx.sessionManager.appendMessage(user);
  chat.sync(ctx, true);
  assert.equal(chat.snapshot().submission?.state, 'settled');
  assert.equal(chat.snapshot().phase, 'idle');
  assert(chat.snapshot().items.some(item => item.text === 'Music question'));
  chat.close(); assert.throws(() => chat.submit(send()), /detached/);
});

test('void dispatch ambiguity is bounded and never auto-resends; terminal prompts and stale aborts are honest', async () => {
  const { chat, ctx, calls, send, setIdle, aborts } = runtime();
  chat.submit(send());
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(chat.snapshot().phase, 'uncertain'); assert.equal(calls.length, 1);
  assert.throws(() => chat.submit(send()), /busy/);
  chat.sync(ctx, true);
  setIdle(false); chat.started(ctx);
  const firstRun = chat.snapshot().runId; assert(firstRun);
  chat.prompt(true); chat.prompt(true); chat.prompt(false);
  assert.equal(chat.snapshot().phase, 'terminal-required');
  chat.prompt(false); assert.equal(chat.snapshot().phase, 'busy');
  const abort: ChatCommand = { kind: 'abort', id: randomUUID(), epoch: chat.epoch, runId: firstRun };
  assert.equal(chat.submit(abort).status, 'stop-requested');
  assert.equal(chat.snapshot().phase, 'stopping'); assert.equal(aborts(), 1);
  chat.sync(ctx, true); chat.started(ctx);
  assert.notEqual(chat.snapshot().runId, firstRun);
  assert.throws(() => chat.submit({ ...abort, id: randomUUID() }), /no longer active/);
  chat.submit(abort); assert.equal(aborts(), 1, 'Duplicate old abort never cancels a newer run');
  const continuation = chat.snapshot().runId; assert(continuation);
  chat.started(ctx);
  assert.throws(() => chat.submit({ ...abort, id: randomUUID(), runId: continuation }), /no longer active/, 'Each actual agent_start invalidates earlier abort targets, even before overall settlement');
  chat.close();
});

test('command ledger is bounded without evicting IDs that could be replayed', () => {
  const { chat, ctx, send, calls } = runtime();
  const first = send(); chat.submit(first); chat.sync(ctx, true);
  for (let i = 1; i < 256; i++) { chat.submit(send()); chat.sync(ctx, true); }
  assert.throws(() => chat.submit(send()), /command limit/);
  chat.submit(first); assert.equal(calls.length, 256);
  chat.close();
});

test('active branch projection includes old compacted text but excludes private roles, results and abandoned branches', () => {
  const manager = SessionManager.inMemory();
  manager.appendMessage({ role: 'system', content: 'SYSTEM_SECRET', timestamp: 0 });
  const old = manager.appendMessage({ role: 'user', content: 'Old canary', timestamp: 1 });
  manager.appendMessage({ role: 'user', content: 'ABANDONED', timestamp: 2 });
  manager.branch(old);
  const kept = manager.appendMessage({ role: 'user', content: 'Current branch', timestamp: 3 });
  manager.appendMessage({ role: 'assistant', content: [
    { type: 'text', text: 'Visible answer' }, { type: 'thinking', thinking: 'THINKING_SECRET' },
    { type: 'toolCall', id: 't1', name: 'read', arguments: { path: 'ARG_SECRET' } },
  ], api: 'openai-completions', provider: 'test', model: 'test', stopReason: 'toolUse', timestamp: 4,
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
  manager.appendMessage({ role: 'toolResult', toolCallId: 't1', toolName: 'read', content: [{ type: 'text', text: 'RESULT_SECRET' }], isError: false, timestamp: 4 });
  manager.appendCompaction('SUMMARY_SECRET', kept, 10000);
  const projected = branchHistory(manager.getBranch());
  assert(projected.items.some(item => item.text === 'Old canary'));
  assert(projected.items.some(item => item.text === 'read · 完成'));
  for (const secret of ['SYSTEM_SECRET', 'ABANDONED', 'RESULT_SECRET', 'SUMMARY_SECRET', 'THINKING_SECRET', 'ARG_SECRET']) assert(!JSON.stringify(projected).includes(secret));
  for (let i = 0; i < 130; i++) manager.appendMessage({ role: 'user', content: `${i} ${'音'.repeat(40000)}`, timestamp: i + 10 });
  const bounded = branchHistory(manager.getBranch());
  assert(bounded.truncated); assert(bounded.items.length <= 100); assert(Buffer.byteLength(JSON.stringify(bounded.items)) < 256 * 1024);
});

function adapter() {
  const listeners = new Set<(view: ChatView) => void>();
  const view: ChatView = { binding: BindingSchema.parse(randomUUID()), epoch: randomUUID(), boardId, sequence: 0, idleVersion: 0, sessionLabel: 'Private canary', phase: 'idle', runId: null, notice: '', submission: null, items: [{ id: 'old', role: 'user', text: 'Private prior history' }], truncated: false };
  const chat: ChatAdapter = { snapshot: () => view, subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; }, submit(command) { return { id: command.id, status: 'submitted' }; } };
  return { chat, view, publish() { view.sequence++; for (const listener of listeners) listener(view); } };
}

test('real private HTTP requires one-use invitation, scoped cookie, same Origin and current epoch', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'tele-chat-api-'));
  const { chat, view, publish } = adapter();
  const service = await startServer({ dataDir: directory, port: 0, chat });
  t.after(async () => { await service.stop(); await rm(directory, { recursive: true, force: true }); });
  const url = new URL(service.inviteChat() ?? '');
  const [binding, invitation] = url.hash.slice(6).split('.');
  const path = `${url.origin}/api/chat/${binding}`;
  const pair = (origin: string | undefined = url.origin) => fetch(`${url.origin}/api/chat/pair`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(origin === undefined ? {} : { Origin: origin }) }, body: JSON.stringify({ binding, invitation }) });
  for (const route of ['', '/status', '/events', '/command']) assert.equal((await fetch(`${path}${route}`)).status, 401);
  assert.equal((await fetch(`${url.origin}/api/capabilities`)).status, 200);
  assert.equal((await pair('null')).status, 403); assert.equal((await pair('https://foreign.test')).status, 403);
  const noOrigin = await fetch(`${url.origin}/api/chat/pair`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ binding, invitation }) });
  assert.equal(noOrigin.status, 403);
  const redeemed = await pair(); assert.equal(redeemed.status, 200);
  assert.equal((await pair()).status, 401);
  const setCookie = redeemed.headers.get('set-cookie'); assert(setCookie);
  assert.match(setCookie, /HttpOnly; SameSite=Strict/); assert(setCookie.includes(`Path=/api/chat/${binding};`));
  const cookie = setCookie.split(';')[0] ?? '';
  const headers = { Cookie: cookie, Origin: url.origin, 'Content-Type': 'application/json' };
  assert.deepEqual(ChatViewSchema.parse(await (await fetch(path, { headers })).json()), view);
  assert.equal((await fetch(`${url.origin}/api/chat/${randomUUID()}`, { headers })).status, 401);
  assert.equal((await fetch(path, { headers: { ...headers, Origin: 'https://foreign.test' } })).status, 403);
  const command = { kind: 'send', id: randomUUID(), epoch: view.epoch, idleVersion: 0, text: 'music' };
  assert.equal((await fetch(`${path}/command`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(command) })).status, 403);
  assert.equal((await fetch(`${path}/command`, { method: 'POST', headers, body: JSON.stringify(command) })).status, 202);
  assert.equal((await fetch(`${path}/command`, { method: 'POST', headers, body: JSON.stringify({ ...command, text: 'x'.repeat(8001) }) })).status, 400);
  const stream = await fetch(`${path}/events`, { headers }); const reader = stream.body?.getReader(); assert(reader);
  assert(new TextDecoder().decode((await reader.read()).value).includes('Private prior history'));
  const extraReaders = [];
  for (let i = 0; i < 3; i++) {
    const connection = await fetch(`${path}/events`, { headers });
    assert.equal(connection.status, 200); const extra = connection.body?.getReader(); assert(extra); await extra.read(); extraReaders.push(extra);
  }
  assert.equal((await fetch(`${path}/events`, { headers })).status, 429);
  for (const extra of extraReaders) await extra.cancel();
  view.epoch = randomUUID(); publish();
  assert.equal((await reader.read()).done, true);
  assert.equal((await fetch(path, { headers })).status, 401);
});

test('expired invitations and cookies fail through real HTTP', async t => {
  const { chat } = adapter(); let now = 0;
  const access = createChatAccess(chat, () => now);
  const server = createServer((request, response) => {
    void access.handle(request, response, new URL(request.url ?? '/', `http://${request.headers.host}`)).catch(error => json(response, error instanceof HttpError ? error.status : 500, { error: 'Rejected' }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { access.close(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const address = server.address(); assert(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  const redeem = (invitationUrl: string) => {
    const [binding, invitation] = new URL(invitationUrl).hash.slice(6).split('.');
    return fetch(`${origin}/api/chat/pair`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ binding, invitation }) });
  };
  const expired = access.invite(origin); now = 120001;
  assert.equal((await redeem(expired)).status, 401);
  const paired = await redeem(access.invite(origin)); assert.equal(paired.status, 200);
  const cookie = paired.headers.get('set-cookie')?.split(';')[0]; assert(cookie);
  const path = `${origin}/api/chat/${chat.snapshot().binding}`;
  assert.equal((await fetch(path, { headers: { Cookie: cookie } })).status, 200);
  now += 8 * 60 * 60_000;
  assert.equal((await fetch(path, { headers: { Cookie: cookie } })).status, 401);
  access.close(); assert.throws(() => access.invite(origin), /detached/);
});

test('board command accepts provider-filled read fields but requires valid versioned writes', () => {
  assert.deepEqual(BoardCommandSchema.parse({ action: 'get', expectedRevision: undefined, content: undefined }), { action: 'get' });
  assert.deepEqual(BoardCommandSchema.parse({ action: 'catalogue', expectedRevision: null, content: null }), { action: 'catalogue' });
  assert.throws(() => BoardCommandSchema.parse({ action: 'get', boardId: 'other' }));
  assert.throws(() => BoardCommandSchema.parse({ action: 'put', expectedRevision: 0, content: null }));
  assert.throws(() => BoardCommandSchema.parse({ action: 'put', content: {} }));
});
