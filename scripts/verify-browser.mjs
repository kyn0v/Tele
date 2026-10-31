import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { chromium } from 'playwright';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const dataDir = await mkdtemp(join(tmpdir(), 'tele-browser-'));
const output = join(root, '.audit', 'browser');
await mkdir(output, { recursive: true });
const reservation = createServer();
reservation.listen(0, '127.0.0.1');
await once(reservation, 'listening');
const address = reservation.address();
assert(address && typeof address !== 'string');
const port = address.port;
await new Promise(resolve => reservation.close(resolve));
const env = { ...process.env, TELE_DATA: dataDir, TELE_PORT: String(port) };
let child;
let browser;
let chat;
async function start() {
  child = spawn(process.execPath, [join(root, 'dist/main.js')], { cwd: tmpdir(), env, stdio: ['ignore', 'pipe', 'pipe'] });
  let errors = '';
  child.stderr.on('data', chunk => { errors += chunk; });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Server startup timed out: ${errors}`)), 10_000);
    child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Server exited ${code}: ${errors}`)); });
    child.stdout.on('data', chunk => { if (String(chunk).includes('"listening"')) { clearTimeout(timeout); resolve(); } });
  });
}
async function stop() {
  if (!child || child.exitCode !== null) return;
  const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited;
}
async function cli(...args) {
  const result = await exec(process.execPath, [join(root, 'dist/cli.js'), ...args], { cwd: tmpdir(), env });
  return JSON.parse(result.stdout);
}
async function assertPlaybackEnded(page) {
  await page.waitForFunction(() => document.querySelector('#stop')?.disabled, undefined, { timeout: 15_000 });
  assert.match(await page.locator('#feedback').textContent(), /播放已结束/);
  assert.equal(await page.locator('.is-active').count(), 0);
  assert.equal(await page.locator('[aria-pressed="true"]').count(), 0);
}
function wav(samples, sampleRate) {
  const buffer = Buffer.alloc(44 + samples.length * 2);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((value, index) => buffer.writeInt16LE(Math.round(Math.max(-1, Math.min(1, value)) * 32767), 44 + index * 2));
  return buffer;
}
try {
  await start();
  const created = await cli('put', 'harmony', '--expect', '0', '--file', join(root, 'examples/major.json'));
  assert.equal(created.revision, 1);
  assert.equal((await cli('get', 'harmony')).revision, 1);
  assert((await cli('catalogue')).chords.some(chord => chord.symbol === 'Gm'));
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 });
  await page.addInitScript(() => {
    const NativeAudioContext = window.AudioContext;
    window.AudioContext = class extends NativeAudioContext {
      constructor(...args) {
        super(...args);
        const output = super.destination;
        const tap = this.createScriptProcessor(256, 1, 1);
        const probe = { context: this, blocks: [] };
        tap.onaudioprocess = event => {
          const input = event.inputBuffer.getChannelData(0);
          event.outputBuffer.getChannelData(0).set(input);
          let peak = 0;
          for (const value of input) peak = Math.max(peak, Math.abs(value));
          probe.blocks.push({ frames: input.length, peak });
        };
        tap.connect(output);
        Object.defineProperty(this, 'destination', { value: tap });
        window.audioProbe = probe;
      }
    };
  });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const session = await page.context().newCDPSession(page);
  const audioContexts = new Map();
  await session.send('WebAudio.enable');
  session.on('WebAudio.contextCreated', ({ context }) => audioContexts.set(context.contextId, context));
  session.on('WebAudio.contextChanged', ({ context }) => audioContexts.set(context.contextId, context));
  chat = createHttpServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(`<a href="${created.url}" rel="noreferrer">Open board</a><a href="http://127.0.0.1:${port}/" rel="noreferrer">Open demo</a>`);
  });
  chat.listen(0, '127.0.0.1');
  await once(chat, 'listening');
  const chatAddress = chat.address();
  assert(chatAddress && typeof chatAddress !== 'string');
  async function followChatLink(name) {
    await page.goto(`http://localhost:${chatAddress.port}`);
    const [response] = await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
      page.getByRole('link', { name, exact: true }).click(),
    ]);
    assert(response);
    const request = name === 'Open demo' ? response.request().redirectedFrom() : response.request();
    const headers = await request.allHeaders();
    assert.equal(headers['sec-fetch-site'], 'cross-site', 'Navigation originates from a different site');
    assert.equal(headers['sec-fetch-mode'], 'navigate');
    assert.equal(headers['sec-fetch-dest'], 'document');
    assert.equal(response.status(), 200, 'A real cross-site chat link opens the board');
  }
  await followChatLink('Open board');
  await page.waitForFunction(() => document.body.dataset.revision === '1');
  assert.equal(audioContexts.size, 0, 'Initial board does not create an AudioContext');
  assert(await page.locator('#stop').isDisabled());
  const iconPath = await page.locator('link[rel="icon"]').getAttribute('href');
  assert.equal(iconPath, '/favicon.svg');
  const icon = await page.request.get(new URL(iconPath, page.url()).href);
  assert.equal(icon.status(), 200);
  assert.match(icon.headers()['content-type'], /^image\/svg\+xml(?:;|$)/);
  assert.match(await icon.text(), /^<svg\b/);
  assert.deepEqual(await page.locator('.chord').evaluateAll(cards => cards.map(card => card.dataset.symbol)), ['D', 'G', 'D']);
  assert.equal(await page.locator('#connection').getAttribute('data-state'), 'connected');
  assert.match(await page.locator('.chord .diagram').first().getAttribute('aria-label'), /不弹、不弹、0、2、3、2/);
  assert.deepEqual(await page.locator('.chord .notes').first().locator('span').allTextContents(), ['×', '×', 'D3', 'A3', 'D4', 'F♯4']);
  await page.locator('.chord').first().click();
  await page.waitForSelector('.chord.is-active');
  assert([...audioContexts.values()].some(context => context.contextType === 'realtime' && context.contextState === 'running'), 'Real click activated a running AudioContext');
  await assertPlaybackEnded(page);
  await page.locator('.chord').first().click();
  await page.waitForSelector('.chord.is-active');
  await page.getByRole('button', { name: '播放整组 大四级', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.chord')[2]?.classList.contains('is-active'));
  assert.match(await page.locator('#feedback').textContent(), /正在按 90 BPM 播放/, 'Superseded chord does not overwrite group playback feedback');
  assert(!(await page.locator('#stop').isDisabled()));
  await assertPlaybackEnded(page);
  const suspendedStop = await page.evaluate(async () => {
    const { scheduleChord } = await import('/assets/audio.js');
    const context = new OfflineAudioContext(1, 48_000 * 3, 48_000);
    const playback = scheduleChord(context, [50, 57, 62, 66], 0.02);
    const suspended = context.suspend(0.128);
    const rendering = context.startRendering();
    await suspended;
    const boundary = Math.round(context.currentTime * context.sampleRate);
    playback.stop();
    await context.resume();
    const samples = (await rendering).getChannelData(0);
    const peak = values => values.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
    return { before: peak(samples.subarray(0, boundary)), after: peak(samples.subarray(boundary)) };
  });
  assert(suspendedStop.before > 0.01, 'Production synthesis is audible before suspension');
  assert.equal(suspendedStop.after, 0, 'Stop during suspension leaves no resumed PCM tail');
  assert(await page.evaluate(() => window.audioProbe.blocks.some(block => block.peak > 0.01)), 'PCM probe detects audible production playback');
  await page.getByRole('button', { name: '播放整组 大四级', exact: true }).click();
  await page.evaluate(() => window.audioProbe.context.suspend());
  await page.waitForTimeout(6_000);
  await page.locator('.chord').first().focus();
  const updated = await cli('put', 'harmony', '--expect', '1', '--file', join(root, 'examples/comparison.json'));
  assert.equal(updated.url, created.url);
  await page.waitForFunction(() => document.body.dataset.revision === '2');
  assert.equal(page.url(), created.url);
  assert.deepEqual(await page.locator('.chord').evaluateAll(cards => cards.map(card => card.dataset.symbol)), ['D', 'G', 'D', 'D', 'Gm', 'D']);
  assert.equal(await page.locator('.is-active').count(), 0);
  assert(await page.locator('#stop').isDisabled());
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-focus')), 'major:0');
  assert.match(await page.locator('#feedback').textContent(), /旧播放已停止/);
  await page.evaluate(async () => {
    window.audioProbe.blocks = [];
    await window.audioProbe.context.resume();
  });
  await page.waitForTimeout(6_000);
  const resumedAudio = await page.evaluate(() => ({
    frames: window.audioProbe.blocks.reduce((sum, block) => sum + block.frames, 0),
    peak: window.audioProbe.blocks.reduce((peak, block) => Math.max(peak, block.peak), 0),
  }));
  assert(resumedAudio.frames > 48_000, 'PCM probe observes resumed audio rendering');
  assert.equal(resumedAudio.peak, 0, 'Suspended old-board voices remain silent after PUT and resume');
  assert.match(await page.locator('#feedback').textContent(), /白板已更新至第 2 版/, 'Cancelled group completion does not overwrite update feedback');
  assert.equal(await page.locator('.is-active').count(), 0, 'Update does not autoplay');
  assert.equal(await page.locator('[aria-pressed="true"]').count(), 0);
  assert(await page.locator('#stop').isDisabled());
  const audio = await page.evaluate(async () => {
    const { scheduleChord } = await import('/assets/audio.js');
    const catalogue = await (await fetch('/api/catalogue')).json();
    const results = [];
    for (const symbol of ['D', 'Gm']) {
      const chord = catalogue.chords.find(chord => chord.symbol === symbol);
      const context = new OfflineAudioContext(1, 48000 * 3, 48000);
      scheduleChord(context, chord.strings.filter(string => string.midi !== null).map(string => string.midi), 0.02);
      const rendered = await context.startRendering();
      const samples = Array.from(rendered.getChannelData(0));
      const peak = samples.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
      const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
      results.push({ symbol, sampleRate: rendered.sampleRate, finite: samples.every(Number.isFinite), peak, rms, samples });
    }
    return results;
  });
  const audioReport = [];
  for (const result of audio) {
    assert(result.finite); assert(result.peak > 0.01 && result.peak < 1); assert(result.rms > 0.001);
    await writeFile(join(output, `${result.symbol}.wav`), wav(result.samples, result.sampleRate));
    const { samples, ...report } = result; audioReport.push(report);
  }
  await page.screenshot({ path: join(output, 'desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.screenshot({ path: join(output, 'mobile.png'), fullPage: true });
  await page.locator('.chord').first().focus();
  await page.keyboard.press('Enter');
  await page.waitForSelector('.chord.is-active');
  await page.locator('#stop').click();
  assert.equal(await page.locator('.is-active').count(), 0);
  assert(await page.locator('#stop').isDisabled());
  await page.waitForTimeout(3_000);
  assert.match(await page.locator('#feedback').textContent(), /已停止播放/, 'Cancelled chord completion does not overwrite stop feedback');
  await stop();
  await page.waitForFunction(() => document.querySelector('#connection')?.getAttribute('data-state') === 'disconnected');
  await start();
  await page.waitForFunction(() => document.querySelector('#connection')?.getAttribute('data-state') === 'connected');
  assert.equal(await page.locator('body').getAttribute('data-revision'), '2');
  await followChatLink('Open demo');
  await page.waitForFunction(() => document.body.dataset.revision === '1');
  assert(page.url().endsWith('/b/demo'));
  assert.equal(await page.locator('.chord').count(), 6);
  assert.deepEqual(errors, [], 'Browser has no console or page errors');
  const report = { cli: 'production put/get/catalogue', liveUpdate: 'same URL, full replacement, focus retained, playback stopped, no autoplay or stale ended feedback', naturalEnd: 'chord and group report ended with no active or pressed controls', linkedNavigation: 'real cross-site chat clicks open board and root', suspendedUpdate: resumedAudio, suspendedStop, favicon: 'local SVG responds 200 with image/svg+xml', keyboard: 'Enter plays, Stop clears active state', connection: 'disconnect and reconnect after restart', layout: '1440px and 390px, no horizontal overflow', audio: audioReport, caveat: 'Offline samples and AudioContext activation verified. No subjective speaker audition.' };
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\nArtifacts: ${output}\n`);
} finally {
  await browser?.close();
  if (chat) await new Promise((resolve, reject) => chat.close(error => error ? reject(error) : resolve()));
  await stop();
  await rm(dataDir, { recursive: true, force: true });
}
