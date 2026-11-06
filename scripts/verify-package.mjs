import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { closeOwnedCommands, runCommand } from './package-command.mjs';
import { artifactDirectory, exportArtifact } from './release.mjs';
const artifactDir = artifactDirectory(process.argv.slice(2));
if (process.env.PLAYWRIGHT_BROWSERS_PATH !== undefined) {
  assert(isAbsolute(process.env.PLAYWRIGHT_BROWSERS_PATH), 'PLAYWRIGHT_BROWSERS_PATH must be absolute');
}
const root = fileURLToPath(new URL('../', import.meta.url));
const hostCli = join(root, 'node_modules/@earendil-works/pi-coding-agent/dist/cli.js');
const directory = await mkdtemp(join(tmpdir(), 'tele-package-'));
const consumer = join(directory, 'consumer');
const home = join(directory, 'home');
const agent = join(home, '.pi/agent');
const installed = join(consumer, 'node_modules/@kyn0v/pi-tele');
const dataDir = join(home, '.tele');
const env = {
  PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
  HOME: home, USERPROFILE: home, TMPDIR: directory, TMP: directory, TEMP: directory,
  PI_CODING_AGENT_DIR: agent, PI_OFFLINE: '1', PI_TELEMETRY: '0',
  npm_config_cache: join(directory, 'npm-cache'), npm_config_userconfig: join(directory, 'npmrc'),
  ...(process.env.PLAYWRIGHT_BROWSERS_PATH ? { PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH } : {}),
};
const runtimeFiles = [
  'dist/main.js', 'dist/cli.js', 'dist/pi-extension.js', 'dist/public/index.html',
  'dist/public/favicon.svg', 'dist/public/assets/web.js', 'dist/public/assets/audio.js', 'dist/public/assets/style.css',
];
const documents = ['README.md', 'README.zh-CN.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md'];
let stage = 'setup';
let pi;
let browser;
let artifact;
const report = { checks: [], modelRuns: 0 };
const check = name => report.checks.push(name);

async function run(file, args, options = {}) {
  return runCommand(file, args, { cwd: consumer, env, timeout: 30_000, maxBuffer: 4 * 1024 * 1024, ...options });
}
async function until(predicate, timeout = 30_000) {
  const end = Date.now() + timeout;
  while (!predicate()) {
    assert(Date.now() < end, 'Timed out waiting for package verification');
    await delay(20);
  }
}
async function bounded(promise, timeout = 10_000) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Verification deadline exceeded')), timeout); })]); }
  finally { clearTimeout(timer); }
}
function validateFiles(paths) {
  const allowed = new Set(['package.json', ...runtimeFiles, ...documents]);
  assert.equal(new Set(paths).size, paths.length, 'No duplicate tar entries');
  assert(paths.every(path => allowed.has(path) || /^docs\/[a-z][a-z-]*\.md$/.test(path) || /^examples\/[a-z][a-z-]*\.json$/.test(path)), 'Only release files may be packed');
  for (const required of [...allowed, 'docs/publishing.md', 'examples/major.json', 'examples/comparison.json', 'examples/cadence.json']) {
    assert(paths.includes(required), `Missing packed file ${required}`);
  }
}
async function install(reinstall = false) {
  if (reinstall) await rm(join(consumer, 'node_modules'), { recursive: true, force: true });
  await run('npm', reinstall
    ? ['ci', '--omit=dev', '--ignore-scripts', '--legacy-peer-deps', '--no-audit', '--no-fund']
    : ['install', '--omit=dev', '--ignore-scripts', '--legacy-peer-deps', '--no-audit', '--no-fund', '--save-exact', artifact], { timeout: 120_000 });
  assert.deepEqual((await readdir(join(consumer, 'node_modules'))).filter(name => !name.startsWith('.')).sort(), ['@kyn0v', 'zod']);
  assert.deepEqual(await readdir(join(consumer, 'node_modules/@kyn0v')), ['pi-tele']);
  for (const path of [installed, join(consumer, 'node_modules/zod')]) assert(!(await lstat(path)).isSymbolicLink(), 'Consumer dependencies must be physical installs');
  assert.deepEqual(JSON.parse(await readFile(join(installed, 'package.json'), 'utf8')).dependencies, { zod: '^4.1.12' });
}
function startPi(extraEnv = {}, flags = []) {
  const child = spawn(process.execPath, [hostCli, '--mode', 'rpc', '--offline', '--no-session', '--no-approve',
    '--no-skills', '--no-context-files', '--no-prompt-templates', '--no-themes', '--no-mcp',
    '--tools', 'read,tele_board', '--tele-port', '0', ...flags], { cwd: consumer, env: { ...env, TELE_PORT: '1', ...extraEnv }, stdio: ['pipe', 'pipe', 'pipe'] });
  let closed = false;
  let failed = false;
  let partial = '';
  let sequence = 0;
  const records = [];
  child.on('close', () => { closed = true; });
  child.on('error', () => { failed = true; });
  child.stdin.on('error', () => { failed = true; });
  child.stderr.resume();
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    partial += chunk;
    if (partial.length > 1024 * 1024) { failed = true; return; }
    let boundary;
    while ((boundary = partial.indexOf('\n')) >= 0) {
      const line = partial.slice(0, boundary); partial = partial.slice(boundary + 1);
      try {
        const record = JSON.parse(line);
        if (record.type === 'agent_start') report.modelRuns++;
        records.push(record);
      } catch { failed = true; }
    }
  });
  const command = async (type, data = {}) => {
    const id = `package-${++sequence}`;
    child.stdin.write(`${JSON.stringify({ id, type, ...data })}\n`);
    await until(() => failed || closed || records.some(record => record.type === 'response' && record.id === id));
    assert(!failed && !closed, 'Pi must stay alive');
    const response = records.find(record => record.type === 'response' && record.id === id);
    assert(response?.success, 'Pi command must succeed');
    return response.data;
  };
  return {
    command,
    async attach(board = 'harmony') {
      const offset = records.length;
      assert.equal((await command('prompt', { message: `/tele ${board}` })).disposition, 'handled');
      const notice = records.slice(offset).find(record => record.type === 'extension_ui_request' && record.method === 'notify' && record.message?.includes('#chat='));
      assert(notice, 'Attach must issue an invitation');
      const invitation = notice.message.match(/http:\/\/127\.0\.0\.1:\d+\/b\/[^\s]+/u)?.[0];
      assert(invitation, 'Attach must provide a private URL');
      return new URL(invitation);
    },
    async close() {
      if (!closed) child.stdin.end();
      try { await until(() => closed, 5000); }
      catch {
        child.kill('SIGTERM');
        try { await until(() => closed, 3000); }
        catch { child.kill('SIGKILL'); await until(() => closed, 3000); }
      }
    },
  };
}
async function request(url) { return fetch(url, { signal: AbortSignal.timeout(10_000) }); }
async function cli(port, ...args) {
  return run(process.execPath, [join(installed, 'dist/cli.js'), ...args], { env: { ...env, TELE_PORT: port } });
}
async function detach(invitation) {
  await pi.command('prompt', { message: '/tele off' });
  assert.equal((await pi.command('get_state')).isStreaming, false, 'Off leaves Pi running');
  await assert.rejects(request(`${invitation.origin}/api/capabilities`), 'Off stops its service');
  await pi.close(); pi = undefined;
}

try {
  await Promise.all([mkdir(consumer), mkdir(home), mkdir(join(directory, 'pack'))]);
  await writeFile(join(consumer, 'package.json'), JSON.stringify({ name: 'tele-package-consumer', private: true, version: '1.0.0' }));
  stage = 'pack with producer prepack';
  const packed = await run('npm', ['pack', '--json', '--ignore-scripts=false', '--pack-destination', join(directory, 'pack')], { cwd: root, timeout: 120_000 });
  const [pack] = JSON.parse(packed.stdout);
  artifact = join(directory, 'pack', pack.filename);
  const listing = (await run('tar', ['-tzf', artifact])).stdout.trim().split('\n');
  assert(listing.every(path => path.startsWith('package/')), 'Tar entries stay under package');
  const paths = listing.map(path => path.slice('package/'.length));
  validateFiles(paths);
  assert.deepEqual(paths.slice().sort(), pack.files.map(file => file.path).sort(), 'Actual tar matches npm file report');
  assert.throws(() => validateFiles([...paths, '.data/capability']), 'Validator rejects private-state leaks');
  assert.throws(() => validateFiles(paths.filter(path => path !== 'dist/pi-extension.js')), 'Validator rejects missing entrypoint');
  const manifest = JSON.parse((await run('tar', ['-xOf', artifact, 'package/package.json'])).stdout);
  assert.equal(manifest.name, '@kyn0v/pi-tele'); assert.equal(manifest.license, 'MIT');
  assert.equal(manifest.repository.url, 'https://github.com/kyn0v/Tele.git');
  assert.equal(manifest.engines.node, '>=22.19.0'); assert.equal(manifest.type, 'module');
  assert.equal(manifest.private, undefined); assert.equal(manifest.bin, undefined);
  assert.deepEqual(manifest.files, ['dist/main.js', 'dist/cli.js', 'dist/pi-extension.js', 'dist/public/', ...documents, 'docs/', 'examples/*.json']);
  assert.deepEqual(manifest.pi, { extensions: ['./dist/pi-extension.js'] });
  assert.deepEqual(manifest.publishConfig, { access: 'public' });
  assert.deepEqual(manifest.keywords, ['pi-package', 'music', 'guitar']);
  assert.deepEqual(manifest.peerDependencies, { '@earendil-works/pi-coding-agent': '*', typebox: '*' });
  assert.equal(manifest.scripts.prepack, 'npm run build');
  for (const hook of ['prepare', 'preinstall', 'install', 'postinstall']) assert.equal(manifest.scripts[hook], undefined);
  report.artifact = { name: pack.name, version: pack.version, files: paths.length, integrity: pack.integrity };
  check('actual tar allowlist, required files, metadata, leak and missing-entry negative controls');

  stage = 'production consumer install without scripts or host peers';
  await install();
  check('physical production install contains only Tele and real Zod, no host peers or dev dependencies');
  stage = 'real Pi local registration';
  await run(process.execPath, [hostCli, 'install', installed]);
  stage = 'isolated Pi package declaration';
  const settings = JSON.parse(await readFile(join(agent, 'settings.json'), 'utf8'));
  assert(settings.packages.some(entry => resolve(agent, typeof entry === 'string' ? entry : entry.source) === installed));
  stage = 'registered extension discovery';
  pi = startPi();
  const commands = (await pi.command('get_commands')).commands.filter(command => command.name === 'tele');
  assert.equal(commands.length, 1);
  assert.equal(commands[0].sourceInfo.path, join(installed, 'dist/pi-extension.js'));
  check('real offline Pi loads exactly one tele command from registered installed dist, without -e');

  stage = 'attach, unauthorized private chat, installed HTTP assets and browser pairing';
  const invitation = await pi.attach();
  const [binding] = invitation.hash.slice(6).split('.');
  assert.equal((await request(`${invitation.origin}/api/chat/${binding}`)).status, 401);
  const html = await request(`${invitation.origin}${invitation.pathname}`);
  assert.equal(html.status, 200);
  assert.equal(await html.text(), await readFile(join(installed, 'dist/public/index.html'), 'utf8'));
  const assets = paths.filter(path => path.startsWith('dist/public/') && !path.endsWith('/index.html'));
  for (const asset of assets) {
    const response = await request(`${invitation.origin}/${asset.slice('dist/public/'.length)}`);
    assert.equal(response.status, 200, `Installed asset is served ${asset}`);
    assert.equal(await response.text(), await readFile(join(installed, asset), 'utf8'));
  }
  browser = await chromium.launch({ headless: true, timeout: 20_000, env });
  const page = await browser.newPage();
  page.setDefaultTimeout(10_000); page.setDefaultNavigationTimeout(10_000);
  let browserErrors = 0;
  page.on('pageerror', () => browserErrors++);
  await page.goto(invitation.href);
  await page.waitForFunction(() => document.querySelector('.chat-panel')?.dataset.phase === 'idle');
  assert.equal(new URL(page.url()).hash, '');
  assert(await page.locator('.chord .diagram').count() > 0, 'Actual chord cards render');
  assert((await page.context().cookies()).some(cookie => cookie.httpOnly && cookie.sameSite === 'Strict' && cookie.path === `/api/chat/${binding}`));
  assert.equal(await bounded(page.evaluate(async () => typeof (await import('/assets/audio.js')).scheduleChord)), 'function');
  check(`private chat rejects anonymous reads, browser pairs and renders chords, HTML and all ${assets.length} browser assets load including audio module`);

  stage = 'installed CLI, default durable home storage and stale-write rejection';
  assert.equal((JSON.parse((await cli(invitation.port, 'get', 'harmony')).stdout)).revision, 1);
  const contentFile = join(installed, 'examples/comparison.json');
  const content = JSON.parse(await readFile(contentFile, 'utf8'));
  const written = JSON.parse((await cli(invitation.port, 'put', 'harmony', '--expect', '1', '--file', contentFile)).stdout);
  assert.equal(written.revision, 2);
  const saved = JSON.parse((await cli(invitation.port, 'get', 'harmony')).stdout);
  assert.deepEqual(saved.content, content); assert.equal(saved.revision, 2);
  await assert.rejects(cli(invitation.port, 'put', 'harmony', '--expect', '1', '--file', contentFile), error => {
    const conflict = JSON.parse(error.stderr);
    return error.code === 1 && conflict.status === 409 && conflict.currentRevision === 2;
  });
  assert.deepEqual(JSON.parse((await cli(invitation.port, 'get', 'harmony')).stdout), saved, 'Conflict never changes the board');
  await page.waitForFunction(() => document.body.dataset.revision === '2');
  assert.deepEqual(await page.locator('.chord').evaluateAll(cards => cards.map(card => card.dataset.symbol)), ['D', 'G', 'D', 'D', 'Gm', 'D']);
  assert.deepEqual(JSON.parse(await readFile(join(dataDir, 'boards/harmony.json'), 'utf8')), saved);
  const capability = await readFile(join(dataDir, 'capability'), 'utf8');
  assert(/^[a-f0-9]{64}$/.test(capability.trim()), 'Durable capability exists outside package');
  assert(!existsSync(join(installed, '.data')) && !existsSync(join(installed, '.tele')), 'Package contains no mutable state');
  assert.equal(browserErrors, 0);
  await bounded(browser.close()); browser = undefined;
  await detach(invitation);
  assert(!existsSync(join(dataDir, 'server.lock')), 'Off releases its lock');
  check('installed CLI get/put/get, 409 without mutation, live browser update, home board and capability, off keeps Pi alive and stops service');

  stage = 'physical reinstall and durable reattachment';
  await install(true);
  pi = startPi();
  const again = await pi.attach();
  assert.deepEqual(JSON.parse((await cli(again.port, 'get', 'harmony')).stdout), saved);
  assert((await readFile(join(dataDir, 'capability'), 'utf8')) === capability, 'Capability survives reinstall');
  await detach(again);
  check('remove and reinstall consumer node_modules, reattach with same board content, revision and capability');

  stage = 'relative TELE_DATA and extension flag precedence';
  pi = startPi({ TELE_DATA: 'relative-data' });
  const relativeInvite = await pi.attach('relative');
  assert(existsSync(join(consumer, 'relative-data/boards/relative.json')), 'Relative TELE_DATA resolves from consumer cwd');
  await detach(relativeInvite);
  pi = startPi({ TELE_DATA: 'unused-data' }, ['--tele-data', 'flag-data']);
  const flagged = await pi.attach('flagged');
  assert(existsSync(join(consumer, 'flag-data/boards/flagged.json')), 'Flag resolves from consumer cwd');
  assert(!existsSync(join(consumer, 'unused-data')), 'Flag wins over TELE_DATA');
  await detach(flagged);
  check('relative TELE_DATA, relative --tele-data precedence and --tele-port 0 overriding TELE_PORT');
  assert.equal(report.modelRuns, 0, 'Slash commands cause no model runs');
  report.ok = true;
  report.limitation = 'Tests npm tarball installation and real Pi local registration, not the Pi npm downloader or registry ownership.';
} catch (error) {
  report.ok = false;
  report.failedStage = stage;
  report.errorKind = error.name;
  report.errorCode = error.code;
  process.exitCode = 1;
} finally {
  const closed = await Promise.allSettled([closeOwnedCommands(), bounded(browser?.close()), pi?.close()]);
  if (closed.some(result => result.status === 'rejected')) {
    report.ok = false; report.failedStage = 'owned process cleanup'; process.exitCode = 1;
  } else {
    try {
      if (report.ok && artifactDir) {
        stage = 'export tested artifact';
        const commit = (await run('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim();
        report.exportedArtifact = await exportArtifact(artifact, artifactDir, commit);
      }
    } catch (error) {
      report.ok = false; report.failedStage = stage; report.errorKind = error.name; report.errorCode = error.code;
      process.exitCode = 1;
    } finally {
      await rm(directory, { recursive: true, force: true });
      check('owned processes closed before temporary directory removal');
    }
  }
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
