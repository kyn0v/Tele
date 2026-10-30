import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { chromium } from 'playwright';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const dataDir = await mkdtemp(join(tmpdir(), 'audioharness-browser-'));
const output = join(root, '.audit', 'browser');
await mkdir(output, { recursive: true });
const reservation = createServer();
reservation.listen(0, '127.0.0.1');
await once(reservation, 'listening');
const address = reservation.address();
assert(address && typeof address !== 'string');
const port = address.port;
await new Promise(resolve => reservation.close(resolve));
const env = { ...process.env, AUDIOHARNESS_DATA: dataDir, AUDIOHARNESS_PORT: String(port) };
let child;
let browser;
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
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const session = await page.context().newCDPSession(page);
  const audioContexts = new Map();
  await session.send('WebAudio.enable');
  session.on('WebAudio.contextCreated', ({ context }) => audioContexts.set(context.contextId, context));
  session.on('WebAudio.contextChanged', ({ context }) => audioContexts.set(context.contextId, context));
  await page.goto(created.url);
  await page.waitForFunction(() => document.body.dataset.revision === '1');
  assert.deepEqual(await page.locator('.chord').evaluateAll(cards => cards.map(card => card.dataset.symbol)), ['D', 'G', 'D']);
  assert.equal(await page.locator('#connection').getAttribute('data-state'), 'connected');
  assert.match(await page.locator('.chord .diagram').first().getAttribute('aria-label'), /不弹、不弹、0、2、3、2/);
  assert.deepEqual(await page.locator('.chord .notes').first().locator('span').allTextContents(), ['×', '×', 'D3', 'A3', 'D4', 'F♯4']);
  await page.locator('.chord').first().click();
  await page.waitForSelector('.chord.is-active');
  assert([...audioContexts.values()].some(context => context.contextType === 'realtime' && context.contextState === 'running'), 'Real click activated a running AudioContext');
  await page.getByRole('button', { name: '播放整组 大四级', exact: true }).click();
  await page.waitForSelector('.chord.is-active');
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
  await stop();
  await page.waitForFunction(() => document.querySelector('#connection')?.getAttribute('data-state') === 'disconnected');
  await start();
  await page.waitForFunction(() => document.querySelector('#connection')?.getAttribute('data-state') === 'connected');
  assert.equal(await page.locator('body').getAttribute('data-revision'), '2');
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => document.body.dataset.revision === '1');
  assert(page.url().endsWith('/b/demo'));
  assert.equal(await page.locator('.chord').count(), 6);
  assert.deepEqual(errors, [], 'Browser has no console or page errors');
  const report = { cli: 'production put/get/catalogue', liveUpdate: 'same URL, full replacement, focus retained, playback stopped', keyboard: 'Enter plays, Stop clears active state', connection: 'disconnect and reconnect after restart', layout: '1440px and 390px, no horizontal overflow', audio: audioReport, caveat: 'Offline samples and AudioContext activation verified. No subjective speaker audition.' };
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\nArtifacts: ${output}\n`);
} finally {
  await browser?.close();
  await stop();
  await rm(dataDir, { recursive: true, force: true });
}
