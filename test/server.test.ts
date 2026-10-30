import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { request } from 'node:http';
import { join } from 'node:path';
import { test } from 'node:test';
import { startServer } from '../src/server.js';
import { BoardSchema, MAX_BODY_BYTES } from '../src/schema.js';

const content = { title: 'Teaching example', groups: [{ id: 'major', title: '大四级', chords: ['D', 'G', 'D'] }] };
async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const dataDir = await mkdtemp(join(tmpdir(), 'audioharness-test-'));
  const server = await startServer({ dataDir, port: 0 });
  t.after(async () => { await server.stop(); await rm(dataDir, { recursive: true, force: true }); });
  const put = (id: string, revision: number, body: unknown = content, headers: Record<string, string> = {}) => fetch(`${server.url}/api/boards/${id}`, {
    method: 'PUT', headers: { Authorization: `Bearer ${server.token}`, 'If-Match': `"${revision}"`, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
  return { server, dataDir, put };
}
async function snapshotReader(response: Response) {
  assert.equal(response.status, 200);
  const reader = response.body?.getReader();
  assert(reader);
  let pending = '';
  return {
    async next(): Promise<unknown> {
      while (!pending.includes('\n\n')) {
        const result = await reader.read();
        if (result.done) throw new Error('SSE ended before snapshot');
        pending += new TextDecoder().decode(result.value);
      }
      const boundary = pending.indexOf('\n\n');
      const event = pending.slice(0, boundary);
      pending = pending.slice(boundary + 2);
      const data = event.split('\n').find(line => line.startsWith('data: '));
      assert(data, event);
      return JSON.parse(data.slice(6));
    },
    cancel: () => reader.cancel(),
  };
}

test('real HTTP create, read, conflict, concurrent writes, isolation, restart and directory lock', async t => {
  const { server, dataDir, put } = await fixture(t);
  const created = await put('harmony', 0);
  assert.equal(created.status, 201);
  assert.equal(created.headers.get('etag'), '"1"');
  assert.deepEqual(await created.json(), { id: 'harmony', revision: 1, content: { ...content, tempo: 90 }, url: `${server.url}/b/harmony` });
  assert.equal((await put('harmony', 0)).status, 409);
  const writes = await Promise.all([put('harmony', 1, { ...content, title: 'One' }), put('harmony', 1, { ...content, title: 'Two' })]);
  assert.deepEqual(writes.map(response => response.status).sort(), [200, 409]);
  assert.equal((await put('separate', 0, { ...content, title: 'Other' })).status, 201);
  const board = BoardSchema.parse(await (await fetch(`${server.url}/api/boards/harmony`)).json());
  assert.equal(board.revision, 2);
  assert.notEqual(board.content.title, 'Other');
  await assert.rejects(startServer({ dataDir, port: 0 }), /Data directory is locked/);
  assert.equal((await stat(join(dataDir, 'capability'))).mode & 0o777, 0o600);
  await server.stop();
  const restarted = await startServer({ dataDir, port: 0 });
  try {
    assert.equal(restarted.token, server.token);
    assert.deepEqual(await (await fetch(`${restarted.url}/api/boards/harmony`)).json(), board);
    assert.equal((await fetch(`${restarted.url}/api/boards/separate`)).status, 200);
  } finally { await restarted.stop(); }
  await mkdir(join(dataDir, 'server.lock'));
  await assert.rejects(startServer({ dataDir, port: 0 }), /After a crash/);
  await rm(join(dataDir, 'server.lock'), { recursive: true });
});

test('identical accepted replacements still increment the revision', async t => {
  const { put } = await fixture(t);
  const first = await put('same', 0);
  const second = await put('same', 1);
  assert.equal(first.status, 201);
  assert.equal(second.status, 200);
  assert.equal(second.headers.get('etag'), '"2"');
});

test('invalid, oversized, unauthenticated and cross-origin updates leave committed content unchanged', async t => {
  const { server, put } = await fixture(t);
  await put('harmony', 0);
  const before = await (await fetch(`${server.url}/api/boards/harmony`)).json();
  assert.equal((await put('harmony', 1, { ...content, groups: [{ id: 'a', title: 'A', chords: ['H'] }] })).status, 400);
  assert.equal((await put('harmony', 1, { ...content, unknown: true })).status, 400);
  assert.equal((await put('harmony', 1, content, { Authorization: 'Bearer wrong' })).status, 401);
  assert.equal((await put('harmony', 1, content, { Authorization: `Bearer ${'é'.repeat(64)}` })).status, 401);
  assert.equal((await put('harmony', 1, content, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await put('harmony', 1, content, { Origin: 'null' })).status, 403);
  const badHostStatus = await new Promise<number | undefined>((resolve, reject) => {
    const req = request(`${server.url}/api/boards/harmony`, { headers: { Host: 'evil.example' } }, response => {
      response.resume(); response.on('end', () => resolve(response.statusCode));
    });
    req.on('error', reject); req.end();
  });
  assert.equal(badHostStatus, 403);
  assert.equal((await put('harmony', 1, content, { 'If-Match': '*' })).status, 400);
  assert.equal((await put('harmony', 1, content, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await fetch(`${server.url}/api/boards/harmony`, { method: 'PUT', headers: { Authorization: `Bearer ${server.token}` } })).status, 428);
  const malformed = await fetch(`${server.url}/api/boards/harmony`, { method: 'PUT', headers: { Authorization: `Bearer ${server.token}`, 'If-Match': '"1"', 'Content-Type': 'application/json' }, body: '{' });
  assert.equal(malformed.status, 400);
  assert.equal((await put('harmony', 1, { text: 'a'.repeat(MAX_BODY_BYTES) })).status, 413);
  const streamedStatus = await new Promise<number | undefined>((resolve, reject) => {
    const req = request(`${server.url}/api/boards/harmony`, {
      method: 'PUT', headers: { Authorization: `Bearer ${server.token}`, 'If-Match': '"1"', 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked' },
    }, response => { response.resume(); response.on('end', () => resolve(response.statusCode)); });
    req.on('error', reject);
    req.write('a'.repeat(MAX_BODY_BYTES / 2));
    req.end('b'.repeat(MAX_BODY_BYTES / 2 + 1));
  });
  assert.equal(streamedStatus, 413);
  assert.equal((await fetch(`${server.url}/capability`)).status, 404);
  assert.equal((await fetch(`${server.url}/.data/capability`)).status, 404);
  assert.equal((await fetch(`${server.url}/assets/../capability`)).status, 404);
  assert.deepEqual(await (await fetch(`${server.url}/api/boards/harmony`)).json(), before);
  assert.equal((await fetch(`${server.url}/api/boards/missing`)).status, 404);
  assert.equal((await fetch(`${server.url}/api/catalogue`)).status, 200);
  assert.equal((await fetch(server.url, { redirect: 'manual' })).headers.get('location'), '/b/demo');
});

test('cross-site exception permits only GET document navigation and retains Origin and capability checks', async t => {
  const { server, put } = await fixture(t);
  const headers = { 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document' };
  const status = (path: string, overrides: Record<string, string> = {}, method = 'GET') => new Promise<number | undefined>((resolve, reject) => {
    const req = request(`${server.url}${path}`, { method, headers: { ...headers, ...overrides } }, response => {
      response.resume(); response.on('end', () => resolve(response.statusCode));
    });
    req.on('error', reject); req.end();
  });
  assert.equal(await status('/'), 302);
  for (const path of ['/api/catalogue', '/api/boards/demo', '/api/boards/demo/events', '/favicon.svg', '/assets/web.js', '/b/Invalid', '/b/demo/extra']) {
    assert.equal(await status(path), 403, path);
  }
  for (const overrides of [
    { 'Sec-Fetch-Mode': 'cors' }, { 'Sec-Fetch-Dest': 'iframe' }, { 'Sec-Fetch-Dest': 'empty' }, { Origin: 'https://chat.example' }, { Host: 'evil.example' },
  ]) assert.equal(await status('/b/demo', overrides), 403);
  assert.equal(await status('/', {}, 'POST'), 403);
  assert.equal((await put('cross-site', 0, content, headers)).status, 403);
  assert.equal((await put('no-token', 0, content, { Authorization: '' })).status, 401);
});

test('SSE sends initial and committed full snapshots, isolates boards and closes on shutdown', { timeout: 5000 }, async t => {
  const { server, put } = await fixture(t);
  await put('harmony', 0);
  const events = await snapshotReader(await fetch(`${server.url}/api/boards/harmony/events`));
  assert.deepEqual(await events.next(), { id: 'harmony', revision: 1, content: { ...content, tempo: 90 } });
  await put('other', 0);
  await put('harmony', 1, { ...content, title: 'Updated' });
  assert.deepEqual(await events.next(), { id: 'harmony', revision: 2, content: { ...content, tempo: 90, title: 'Updated' } });
  assert.equal((await put('harmony', 1)).status, 409);
  await put('harmony', 2, { ...content, title: 'Latest' });
  const committed = await events.next();
  assert.deepEqual(committed, { id: 'harmony', revision: 3, content: { ...content, tempo: 90, title: 'Latest' } });
  await events.cancel();
  const controller = new AbortController();
  const response = await fetch(`${server.url}/api/boards/harmony/events`, { signal: controller.signal });
  const reader = response.body?.getReader();
  assert(reader);
  await reader.read();
  await server.stop();
  assert.equal((await reader.read()).done, true);
});

test('persistence failure does not alter live board or announce an uncommitted revision', async t => {
  const { server, dataDir, put } = await fixture(t);
  await put('harmony', 0);
  const events = await snapshotReader(await fetch(`${server.url}/api/boards/harmony/events`));
  await events.next();
  const path = join(dataDir, 'boards', 'harmony.json');
  const saved = await readFile(path, 'utf8');
  await rm(path);
  await mkdir(path);
  assert.equal((await put('harmony', 1, { ...content, title: 'Never committed' })).status, 500);
  assert.deepEqual(await (await fetch(`${server.url}/api/boards/harmony`)).json(), JSON.parse(saved));
  await rm(path, { recursive: true });
  await writeFile(path, saved);
  assert.equal((await put('harmony', 1, { ...content, title: 'Committed' })).status, 200);
  assert.deepEqual(await events.next(), { id: 'harmony', revision: 2, content: { ...content, title: 'Committed', tempo: 90 } });
  await events.cancel();
});

test('corrupt persisted data fails explicitly and releases startup lock', async t => {
  const { server, dataDir, put } = await fixture(t);
  await put('harmony', 0);
  await server.stop();
  const path = join(dataDir, 'boards', 'harmony.json');
  const valid = await readFile(path, 'utf8');
  await writeFile(path, '{');
  await assert.rejects(startServer({ dataDir, port: 0 }), /JSON/);
  await assert.rejects(stat(join(dataDir, 'server.lock')), error => error instanceof Error && 'code' in error && error.code === 'ENOENT');
  await writeFile(path, ' '.repeat(MAX_BODY_BYTES + 1025));
  await assert.rejects(startServer({ dataDir, port: 0 }), /Oversized stored board/);
  await writeFile(path, valid);
  const recovered = await startServer({ dataDir, port: 0 });
  await recovered.stop();
});

test('failed port bind releases the new data directory lock', async t => {
  const { server } = await fixture(t);
  const dataDir = await mkdtemp(join(tmpdir(), 'audioharness-bind-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  await assert.rejects(startServer({ dataDir, port: server.port }), /EADDRINUSE/);
  const recovered = await startServer({ dataDir, port: 0 });
  await recovered.stop();
});
