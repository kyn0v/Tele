import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

// Read-only black-box verification of the URL returned by a REAL installed DSH
// tele_board call. No server is started, no profile or board is modified, and
// no DSH/browser credentials are accessed. This is not a mock Harness page.
const url = new URL(process.argv[2]);
assert.equal(process.argv.length, 3, 'Pass the public board URL returned by tele_board');
assert.equal(url.protocol, 'http:');
assert.equal(url.hostname, '127.0.0.1');
assert.match(url.pathname, /^\/b\/([a-z0-9][a-z0-9-]{0,47})$/);
assert(!url.search && !url.hash, 'Use a public board URL, never a private pairing URL');
const boardId = url.pathname.slice(3);
const root = fileURLToPath(new URL('../', import.meta.url));
await mkdir(join(root, '.audit'), { recursive: true });
const output = await mkdtemp(join(root, '.audit/dsh-live-'));
const request = (path, options = {}) => fetch(new URL(path, url), { ...options, signal: AbortSignal.timeout(10_000) });
const boardResponse = await request(`/api/boards/${boardId}`);
assert.equal(boardResponse.status, 200);
const board = await boardResponse.json();
assert.equal(board.id, boardId);
assert.deepEqual(await (await request('/api/capabilities')).json(), { chat: false, chatPanel: false });
for (const path of ['/api/chat', '/api/chat/history', '/api/chat/pair']) assert.equal((await request(path)).status, 404);
assert.equal((await request(`/api/boards/${boardId}`, { headers: { Origin: 'http://example.invalid' } })).status, 403);
assert.equal((await request(`/api/boards/${boardId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'If-Match': `"${board.revision}"` }, body: JSON.stringify(board.content) })).status, 401);
for (const path of ['/favicon.svg', '/assets/web.js', '/assets/audio.js', '/assets/style.css']) {
  const response = await request(path);
  assert.equal(response.status, 200, path);
  assert((await response.arrayBuffer()).byteLength > 0, path);
}
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, locale: 'zh-CN' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const session = await page.context().newCDPSession(page);
  const contexts = new Map();
  await session.send('WebAudio.enable');
  session.on('WebAudio.contextCreated', ({ context }) => contexts.set(context.contextId, context));
  session.on('WebAudio.contextChanged', ({ context }) => contexts.set(context.contextId, context));
  const capabilitiesResponse = page.waitForResponse(response => response.url().endsWith('/api/capabilities'));
  assert.equal((await page.goto(url.href))?.status(), 200);
  await page.waitForFunction(revision => document.body.dataset.revision === String(revision), board.revision);
  assert.deepEqual(await (await capabilitiesResponse).json(), { chat: false, chatPanel: false });
  assert.equal(await page.locator('#title').textContent(), board.content.title);
  assert.equal(await page.locator('.chat-panel').count(), 0, 'DSH must not show an unusable Pi chat panel');
  assert.equal(await page.locator('#connection').getAttribute('data-state'), 'connected');
  assert.deepEqual(await page.locator('.chord').evaluateAll(cards => cards.map(card => card.dataset.symbol)), board.content.groups.flatMap(group => group.chords));
  assert.equal(contexts.size, 0, 'Initial load must not autoplay');
  await page.locator('.chord').first().click();
  await page.waitForSelector('.chord.is-active');
  assert([...contexts.values()].some(context => context.contextType === 'realtime' && context.contextState === 'running'), 'Click must activate real Web Audio');
  await page.locator('#stop').click();
  assert(await page.locator('#stop').isDisabled());
  assert.equal(await page.locator('.is-active').count(), 0);
  await page.screenshot({ path: join(output, 'board-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Mobile page must not overflow horizontally');
  await page.screenshot({ path: join(output, 'board-mobile.png'), fullPage: true });
  assert.deepEqual(errors, []);
  const report = {
    url: url.href, boardId, revision: board.revision,
    checks: ['real installed DSH server public board', 'all production browser assets', 'private chat unavailable', 'foreign Origin and unauthenticated write rejected', 'rendered title/chord order/SSE connection', 'no autoplay; real Web Audio starts on click and stops', 'desktop/mobile layout; no browser errors'],
    limitations: ['Does not mutate the board or verify an update event in this run', 'Does not inspect the authenticated DSH Plugin Manager UI or its rendered metadata/icon', 'Automated audio activation is not subjective listening', 'Caller must supply a URL from an actual DSH tele_board call; the script alone cannot prove server ownership'],
  };
  await writeFile(join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify({ output, ...report }, null, 2));
} finally { await browser?.close(); }
