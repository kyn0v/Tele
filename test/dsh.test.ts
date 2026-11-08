import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { createServer } from 'node:net';
import { test, type TestContext } from 'node:test';
import { createDshPlugin, BOARD_TOOL, Config, PUBLIC_FILES, type DshContext, type DshTool } from '../src/dsh-extension.js';
import { openStore, StoreError } from '../src/boards.js';
import { BoardIdSchema, ContentSchema, MAX_BODY_BYTES, RevisionSchema } from '../src/schema.js';

// Deliberately a structural, effect-aware unit fixture, NOT a real Cordis/DSH
// integration test. It joins async setup/cleanup and models duplicate names.
function contextFixture() {
  const registered = new Map<string, DshTool>();
  const effects: Promise<() => Promise<void>>[] = [];
  const ctx: DshContext = {
    effect(setup) {
      let cleanup: Promise<void> | undefined;
      const ready = setup().then(dispose => () => cleanup ??= dispose());
      effects.push(ready);
      return ready;
    },
    tools: {
      register(definition) {
        if (registered.has(definition.name)) throw new Error(`Duplicate tool: ${definition.name}`);
        registered.set(definition.name, definition);
        return () => { if (registered.get(definition.name) === definition) registered.delete(definition.name); };
      },
    },
  };
  return {
    ctx, registered,
    async dispose() {
      // A failed setup is already rolled back by apply; still await every one.
      await Promise.all(effects.map(async effect => {
        let dispose: () => Promise<void>;
        try { dispose = await effect; } catch { return; }
        await dispose();
      }));
    },
    tool() { const tool = registered.get(BOARD_TOOL); assert(tool); return tool; },
  };
}

async function temporary(t: TestContext, beforeRemove?: () => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'tele-dsh-test-'));
  t.after(async () => {
    await beforeRemove?.();
    // Only remove the exact absolute, uniquely owned fixture returned by mkdtemp.
    assert(isAbsolute(directory) && basename(directory).startsWith('tele-dsh-test-'));
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
}
// Synthetic nonempty routing fixtures, NOT the production UI or a browser test.
// Tests must run before build in a fresh checkout and never create/read dist.
const assetBytes: Record<(typeof PUBLIC_FILES)[number], string> = {
  'index.html': '<!doctype html><html><body>Tele unit fixture</body></html>\n',
  'favicon.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><path d="M0 0h1v1H0z"/></svg>\n',
  'assets/web.js': 'export const fixture = "tele-unit-web";\n',
  'assets/audio.js': 'export const fixture = "tele-unit-audio";\n',
  'assets/style.css': 'body { margin: 0; } /* tele-unit-style */\n',
};
async function publicFixture(directory: string, missing?: (typeof PUBLIC_FILES)[number]) {
  const publicDir = join(directory, 'public');
  await mkdir(publicDir, { recursive: true });
  for (const file of PUBLIC_FILES) {
    if (file === missing) continue;
    const path = join(publicDir, file);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, assetBytes[file]);
  }
  return publicDir;
}
async function fixture(t: TestContext) {
  const context = contextFixture();
  const directory = await temporary(t, () => context.dispose());
  const dataDir = join(directory, 'data');
  const publicDir = await publicFixture(directory);
  const activate = createDshPlugin(publicDir);
  await activate(context.ctx, { dataDir, port: 0 });
  const tool = context.tool();
  const call = (input: unknown, signal = new AbortController().signal) => tool.execute(input, { signal });
  return { directory, dataDir, publicDir, activate, context, tool, call };
}
const content = ContentSchema.parse({ title: 'DSH listening board', groups: [{ id: 'major', title: 'Major IV', chords: ['D', 'G', 'D'] }] });
type BoardResult = { id: string; revision: number; content: typeof content; url: string };
function boardResult(value: unknown): BoardResult {
  assert(value && typeof value === 'object' && 'url' in value);
  return value as BoardResult;
}
async function assertUnlocked(dataDir: string) {
  await assert.rejects(stat(join(dataDir, 'server.lock')), { code: 'ENOENT' });
  const store = openStore(dataDir);
  store.close();
}

test('DSH Config is strict, absolute, port-zero capable and independent of Pi environment', () => {
  assert.deepEqual(Config.parse({}), { dataDir: join(homedir(), '.tele', 'dsh'), port: 0 });
  for (const config of [
    { port: -1 }, { port: 65536 }, { port: 0.5 }, { port: '0' },
    { dataDir: '' }, { dataDir: 'relative/data' }, { dataDir: '/tmp', chat: true }, { bindHost: '0.0.0.0' },
    { publicDir: '/tmp/arbitrary-user-assets' },
  ]) assert.equal(Config.safeParse(config).success, false, JSON.stringify(config));
  assert.equal(Config.parse({ port: 65535 }).port, 65535);
  const oldPort = process.env.TELE_PORT;
  const oldData = process.env.TELE_DATA;
  try {
    process.env.TELE_PORT = 'invalid-Pi-port';
    process.env.TELE_DATA = 'relative-Pi-directory';
    assert.deepEqual(Config.parse({}), { dataDir: join(homedir(), '.tele', 'dsh'), port: 0 });
  } finally {
    if (oldPort === undefined) delete process.env.TELE_PORT; else process.env.TELE_PORT = oldPort;
    if (oldData === undefined) delete process.env.TELE_DATA; else process.env.TELE_DATA = oldData;
  }
});

test('DSH missing assets fail activation before creating any data directory or lock', async t => {
  for (const missing of PUBLIC_FILES) {
    await t.test(`missing ${missing}`, async subtest => {
      const context = contextFixture();
      const directory = await temporary(subtest, () => context.dispose());
      const publicDir = await publicFixture(directory, missing);
      const dataDir = join(directory, 'never-created-data');
      const activate = createDshPlugin(publicDir);
      await assert.rejects(activate(context.ctx, { dataDir, port: 0 }), (error: unknown) => {
        assert(error instanceof Error && 'code' in error && error.code === 'ENOENT');
        assert('path' in error && error.path === join(publicDir, missing));
        return true;
      });
      await assert.rejects(stat(dataDir), { code: 'ENOENT' });
      await assert.rejects(stat(join(dataDir, 'server.lock')), { code: 'ENOENT' });
      assert.equal(context.registered.size, 0);
      assert.deepEqual(await readdir(directory), ['public']);
    });
  }
});

test('DSH nonregular browser assets fail activation before creating data or tools', async t => {
  const context = contextFixture();
  const directory = await temporary(t, () => context.dispose());
  const publicDir = await publicFixture(directory, 'index.html');
  await mkdir(join(publicDir, 'index.html'));
  const dataDir = join(directory, 'never-created-data');
  await assert.rejects(createDshPlugin(publicDir)(context.ctx, { dataDir, port: 0 }), /not a regular file: index\.html/);
  await assert.rejects(stat(dataDir), { code: 'ENOENT' });
  await assert.rejects(stat(join(dataDir, 'server.lock')), { code: 'ENOENT' });
  assert.equal(context.registered.size, 0);
  assert.deepEqual(await readdir(directory), ['public']);
});

test('DSH structural tool supplies catalogue, missing/create/read/update and public URL without secrets', async t => {
  const { call, tool, dataDir, context } = await fixture(t);
  assert.deepEqual([...context.registered.keys()], [BOARD_TOOL]);
  assert.equal(tool.parameters.type, 'object');
  assert.deepEqual(tool.output.schema, { type: 'object', additionalProperties: true });
  const catalogue = await call({ action: 'catalogue' });
  assert(catalogue && typeof catalogue === 'object' && 'chords' in catalogue);
  assert.deepEqual(await call({ action: 'get', boardId: 'missing' }), { boardId: 'missing', exists: false, revision: 0 });
  const created = boardResult(await call({ action: 'put', boardId: 'harmony', expectedRevision: 0, content }));
  assert.equal(created.revision, 1);
  assert.match(created.url, /^http:\/\/127\.0\.0\.1:[1-9][0-9]*\/b\/harmony$/);
  assert.deepEqual(await call({ action: 'get', boardId: 'harmony' }), created);
  const updated = boardResult(await call({ action: 'put', boardId: 'harmony', expectedRevision: 1, content: { ...content, title: 'Updated' } }));
  assert.equal(updated.revision, 2);
  assert.equal(updated.url, created.url);
  assert.equal(tool.isConcurrencySafe({ action: 'get', boardId: 'harmony' }), true);
  assert.equal(tool.isConcurrencySafe({ action: 'put', boardId: 'harmony', expectedRevision: 2, content }), false);
  const token = (await readFile(join(dataDir, 'capability'), 'utf8')).trim();
  for (const value of [catalogue, created, updated]) {
    assert(!JSON.stringify(value).includes(token));
    const rendered = tool.output.render({}, value);
    assert.deepEqual(rendered, [{ type: 'text', text: JSON.stringify(value) }]);
    assert(!JSON.stringify(rendered).includes(token));
  }
  // Results do not expose mutable references to the in-memory store.
  created.content.title = 'Caller mutation';
  assert.equal(boardResult(await call({ action: 'get', boardId: 'harmony' })).content.title, 'Updated');
});

test('DSH provider-filled read fields are ignored without performing writes or weakening put validation', async t => {
  const { call, dataDir } = await fixture(t);
  const catalogue = await call({ action: 'catalogue' });
  const filled = { boardId: '../irrelevant', expectedRevision: -1, content: { invalid: true } };
  assert.deepEqual(await call({ action: 'catalogue', ...filled }), catalogue);
  assert.deepEqual(await call({ action: 'catalogue', boardId: null, expectedRevision: null, content: null }), catalogue);
  assert.deepEqual(await call({ action: 'get', ...filled, boardId: 'missing' }), { boardId: 'missing', exists: false, revision: 0 });
  assert.deepEqual(await readdir(join(dataDir, 'boards')), []);
  await assert.rejects(call({ action: 'put', ...filled }));
  await assert.rejects(call({ action: 'get', ...filled }));
  await assert.rejects(call({ action: 'catalogue', ...filled, unknown: true }));
  await assert.rejects(call({ action: 'put', boardId: 'valid', expectedRevision: null, content }));
});

test('DSH validates raw arguments and pre-cancellation before mutating persisted boards', async t => {
  const { call, dataDir } = await fixture(t);
  await call({ action: 'put', boardId: 'harmony', expectedRevision: 0, content });
  const before = await readFile(join(dataDir, 'boards/harmony.json'), 'utf8');
  const put = { action: 'put', boardId: 'harmony', expectedRevision: 1, content };
  for (const input of [
    null, { action: 'unknown' }, { action: 'catalogue', unexpected: 'harmony' },
    { action: 'get', boardId: '../escape' }, { action: 'get' }, { ...put, expectedRevision: -1 },
    { ...put, expectedRevision: Number.MAX_SAFE_INTEGER }, { ...put, extra: true },
    { ...put, content: { ...content, groups: [{ id: 'a', title: 'A', chords: ['H'] }] } },
    { ...put, content: { ...content, groups: [content.groups[0], content.groups[0]] } },
  ]) await assert.rejects(call(input));
  const controller = new AbortController();
  controller.abort(new Error('Fixture cancellation'));
  await assert.rejects(call(put, controller.signal), /Fixture cancellation/);
  await assert.rejects(call({ action: 'catalogue' }, controller.signal), /Fixture cancellation/);
  assert.equal(await readFile(join(dataDir, 'boards/harmony.json'), 'utf8'), before);
  assert.deepEqual(await readdir(join(dataDir, 'boards')), ['harmony.json']);
});

test('DSH concurrent same-revision writes admit one commit and preserve boards across reactivation', async t => {
  const { call, dataDir, activate, context } = await fixture(t);
  await call({ action: 'put', boardId: 'harmony', expectedRevision: 0, content });
  const writes = await Promise.allSettled(['One', 'Two'].map(title => call({ action: 'put', boardId: 'harmony', expectedRevision: 1, content: { ...content, title } })));
  assert.equal(writes.filter(result => result.status === 'fulfilled').length, 1);
  const rejected = writes.find(result => result.status === 'rejected');
  assert(rejected?.status === 'rejected');
  assert(rejected.reason instanceof StoreError);
  assert.equal(rejected.reason.status, 409);
  assert.equal(rejected.reason.currentRevision, 2);
  const before = boardResult(await call({ action: 'get', boardId: 'harmony' }));
  const token = await readFile(join(dataDir, 'capability'), 'utf8');
  await context.dispose();
  const restarted = contextFixture();
  try {
    await activate(restarted.ctx, { dataDir, port: 0 });
    const after = boardResult(await restarted.tool().execute({ action: 'get', boardId: 'harmony' }, { signal: new AbortController().signal }));
    assert.deepEqual({ ...after, url: before.url }, before);
    assert.equal(await readFile(join(dataDir, 'capability'), 'utf8'), token);
  } finally { await restarted.dispose(); }
});

test('DSH stop unregisters tools, closes SSE, releases its port and data lock, and rejects captured tool calls', { timeout: 5000 }, async t => {
  const { call, context, dataDir } = await fixture(t);
  const board = boardResult(await call({ action: 'put', boardId: 'harmony', expectedRevision: 0, content }));
  const origin = new URL(board.url).origin;
  const response = await fetch(`${origin}/api/boards/harmony/events`);
  const reader = response.body?.getReader();
  assert(reader);
  assert.equal((await reader.read()).done, false);
  await Promise.all([context.dispose(), context.dispose()]);
  assert.equal(context.registered.size, 0);
  assert.equal((await reader.read()).done, true);
  await assert.rejects(call({ action: 'get', boardId: 'harmony' }), /Tele is stopping/);
  await assertUnlocked(dataDir);
  const listener = createServer();
  try {
    await new Promise<void>((resolve, reject) => { listener.once('error', reject); listener.listen(Number(new URL(origin).port), '127.0.0.1', resolve); });
  } finally {
    await new Promise<void>((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
  }
});

test('DSH duplicate registration rolls back only its own new service and lock', async t => {
  const { context, directory, activate, call, dataDir } = await fixture(t);
  const otherData = join(directory, 'duplicate');
  await assert.rejects(activate(context.ctx, { dataDir: otherData, port: 0 }), /Duplicate tool/);
  await assertUnlocked(otherData);
  assert.equal(context.registered.size, 1);
  assert.deepEqual(await call({ action: 'get', boardId: 'missing' }), { boardId: 'missing', exists: false, revision: 0 });
  await assert.rejects(activate(context.ctx, { dataDir, port: 0 }), /Data directory is locked/);
  assert.equal(context.registered.size, 1);
});

function escapedContent() {
  return ContentSchema.parse({
    title: '\u0000'.repeat(120), description: '\u0000'.repeat(1200),
    groups: Array.from({ length: 12 }, (_, index) => ({ id: `group-${index}`, title: '\u0000'.repeat(120), description: '\u0000'.repeat(1200), chords: ['D'] })),
  });
}

test('DSH rejects schema-valid oversized escaped JSON and leaves a restartable board unchanged', async t => {
  const { call, dataDir, context } = await fixture(t);
  await call({ action: 'put', boardId: 'harmony', expectedRevision: 0, content });
  const oversized = escapedContent();
  assert(Buffer.byteLength(JSON.stringify(oversized), 'utf8') > MAX_BODY_BYTES + 1024);
  const before = await readFile(join(dataDir, 'boards/harmony.json'), 'utf8');
  await assert.rejects(call({ action: 'put', boardId: 'harmony', expectedRevision: 1, content: oversized }), /UTF-8 JSON bytes/);
  assert.equal(await readFile(join(dataDir, 'boards/harmony.json'), 'utf8'), before);
  await context.dispose();
  const store = openStore(dataDir);
  try { assert.equal(store.get(BoardIdSchema.parse('harmony'))?.revision, 1); } finally { store.close(); }
});

test('store direct writes enforce runtime validation and final serialized size before disk/cache publication', async t => {
  const directory = await temporary(t);
  const store = openStore(directory);
  const id = BoardIdSchema.parse('harmony');
  store.put(id, RevisionSchema.parse(0), content);
  const before = await readFile(join(directory, 'boards/harmony.json'), 'utf8');
  assert.throws(() => store.put(id, RevisionSchema.parse(1), escapedContent()), (error: unknown) => error instanceof StoreError && error.status === 413);
  assert.throws(() => store.put('../escape' as typeof id, RevisionSchema.parse(1), content));
  assert.throws(() => store.put(id, -1 as ReturnType<typeof RevisionSchema.parse>, content));
  assert.equal(store.get(id)?.revision, 1);
  assert.equal(await readFile(join(directory, 'boards/harmony.json'), 'utf8'), before);
  assert.deepEqual(await readdir(join(directory, 'boards')), ['harmony.json']);
  store.close();
  const reopened = openStore(directory);
  try { assert.equal(reopened.get(id)?.revision, 1); } finally { reopened.close(); }
});

test('DSH serves exact configured synthetic fixture bytes while chat and chat panel are disabled', async t => {
  const { call } = await fixture(t);
  const board = boardResult(await call({ action: 'put', boardId: 'harmony', expectedRevision: 0, content }));
  const origin = new URL(board.url).origin;
  assert.deepEqual(await (await fetch(`${origin}/api/capabilities`)).json(), { chat: false, chatPanel: false });
  for (const file of PUBLIC_FILES) {
    const path = file === 'index.html' ? '/b/harmony' : `/${file}`;
    const response = await fetch(`${origin}${path}`);
    assert.equal(response.status, 200, path);
    assert.equal(Buffer.from(await response.arrayBuffer()).toString('utf8'), assetBytes[file], path);
  }
  for (const path of ['/api/chat', '/api/chat/history', '/api/chat/commands', '/api/chat/pair']) {
    assert.equal((await fetch(`${origin}${path}`)).status, 404, path);
  }
  assert.equal((await fetch(`${origin}/api/boards/harmony`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'If-Match': '"1"' }, body: JSON.stringify(content) })).status, 401);
});
