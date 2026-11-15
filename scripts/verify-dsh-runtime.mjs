import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFile, stat, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'node:net';

const root = fileURLToPath(new URL('../', import.meta.url));
const script = fileURLToPath(import.meta.url);

export function parseArguments(args) {
  let expectIncompatible = false;
  let manifestRef;
  let runtimeChild = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--runtime-child' && !runtimeChild) runtimeChild = true;
    else if (arg === '--expect-incompatible' && !expectIncompatible) expectIncompatible = true;
    else if (arg === '--manifest-ref' && manifestRef === undefined) {
      manifestRef = args[++index];
      assert(typeof manifestRef === 'string' && /^[A-Za-z0-9][A-Za-z0-9._/-]{0,120}$/.test(manifestRef), 'Pass a canonical Git ref after --manifest-ref');
    } else throw new Error(`Unknown or repeated argument: ${arg}`);
  }
  return { expectIncompatible, manifestRef, runtimeChild };
}

export function runtimeInvocation(env, args = []) {
  const executable = env.DSH_NODE_EXECUTABLE;
  const installDir = env.DSH_INSTALL_DIR;
  assert(typeof executable === 'string' && isAbsolute(executable), 'Set DSH_NODE_EXECUTABLE to the running DSH executable; do not substitute PATH node');
  assert(typeof installDir === 'string' && isAbsolute(installDir), 'Set DSH_INSTALL_DIR to the verified @deepseek-ai/dsh package directory');
  return {
    executable,
    args: [script, '--runtime-child', ...args],
    env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
  };
}

async function verifyRuntime({ expectIncompatible, manifestRef }) {
  assert(process.versions.electron, 'This test requires the installed Electron Node runtime with ASAR-aware reads');
  const installDir = process.env.DSH_INSTALL_DIR;
  assert(installDir && isAbsolute(installDir));
  const installation = JSON.parse(await readFile(join(installDir, 'package.json'), 'utf8'));
  assert.equal(installation.name, '@deepseek-ai/dsh');
  assert.equal(installation.version, '0.2.2-rc.3', 'Verify the requested installed release, not another checkout');
  const requireFromDsh = createRequire(join(installDir, 'package.json'));
  const moduleOf = name => import(pathToFileURL(requireFromDsh.resolve(name)).href);
  const versionOf = async name => JSON.parse(await readFile(requireFromDsh.resolve(`${name}/package.json`), 'utf8')).version;
  const { evaluatePluginCompatibility } = await moduleOf('@deepseek-ai/dsh-app-boot');
  const manifest = manifestRef === undefined
    ? JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
    : JSON.parse(execFileSync('git', ['show', `${manifestRef}:package.json`], { cwd: root, encoding: 'utf8', timeout: 15000 }));
  assert.equal(manifest.name, '@kyn0v/pi-tele');
  const compatibility = evaluatePluginCompatibility(manifest, {}, installation.version);
  if (expectIncompatible) {
    assert(compatibility && !compatibility.exempted, 'Expected an actual incompatibility refusal for the selected manifest');
    assert.equal(compatibility.requirements['engines.dsh'], manifest.engines.dsh);
    return { ok: true, mode: 'expected-incompatible', runtime: installation.version, manifestVersion: manifest.version, manifestRef: manifestRef ?? null, requirements: compatibility.requirements, pluginExecuted: false };
  }
  assert.equal(compatibility, undefined, 'Current manifest must admit the actual rc.3 runtime without an exemption');
  assert.equal(evaluatePluginCompatibility(manifest, {}, '0.2.2-rc.1'), undefined, 'Retain declared rc.1 admission');
  for (const version of ['0.2.2-rc.2', '0.2.2-rc.4', '0.2.2', '0.2.3']) {
    const refusal = evaluatePluginCompatibility(manifest, {}, version);
    assert(refusal && !refusal.exempted, `Do not admit undeclared version ${version}`);
  }
  const oldDeclaration = { ...manifest, engines: { ...manifest.engines, dsh: '0.2.2-rc.1' } };
  assert(evaluatePluginCompatibility(oldDeclaration, {}, installation.version), 'Old exact declaration must remain a negative control');

  const versions = {
    dsh: installation.version,
    cordis: await versionOf('@deepseek-ai/cordis'),
    tools: await versionOf('@deepseek-ai/dsh-tools'),
    executor: await versionOf('@deepseek-ai/dsh-tool-executor-native'),
    appBoot: await versionOf('@deepseek-ai/dsh-app-boot'),
    systemPrompt: await versionOf('@deepseek-ai/dsh-system-prompt'),
    zod: JSON.parse(await readFile(createRequire(join(root, 'package.json')).resolve('zod/package.json'), 'utf8')).version,
    node: process.versions.node,
    electron: process.versions.electron,
  };
  for (const name of ['tools', 'executor', 'appBoot', 'systemPrompt']) assert.equal(versions[name], installation.version);
  assert.match(versions.zod, /^4\./, 'The Tele Config must use the actual Zod4 dependency');
  const { Context } = await moduleOf('@deepseek-ai/cordis');
  const { default: SystemPrompt } = await moduleOf('@deepseek-ai/dsh-system-prompt');
  const { default: ToolsService } = await moduleOf('@deepseek-ai/dsh-tools');
  const native = await moduleOf('@deepseek-ai/dsh-tool-executor-native');
  const plugin = await import(pathToFileURL(join(root, 'dist/dsh-extension.js')).href);
  assert.equal(plugin.Config['~standard'].vendor, 'zod');
  const parsed = plugin.Config['~standard'].validate({ dataDir: join(tmpdir(), 'unused-config-check'), port: 0 });
  assert(!('then' in parsed) && !parsed.issues, 'Cordis requires a synchronous StandardSchema result');
  assert.equal(plugin.Config['~standard'].validate({ port: -1 }).issues?.length > 0, true);

  const directory = await mkdtemp(join(tmpdir(), 'tele-dsh-runtime-'));
  assert(isAbsolute(directory) && basename(directory).startsWith('tele-dsh-runtime-'));
  const dataDir = join(directory, 'data');
  const ctx = new Context();
  let port;
  let fiber;
  let sequence = 0;
  let reader;
  const call = async (args, signal = new AbortController().signal, name = plugin.BOARD_TOOL) => {
    const batch = await ctx.tools.execute({ calls: [{ type: 'tool_call', id: `runtime-${++sequence}`, name, arguments: JSON.stringify(args) }], signal });
    assert.equal(batch.results.length, 1);
    return batch.results[0].result;
  };
  const valueOf = result => {
    assert.equal(result.isError, false, JSON.stringify(result));
    assert.deepEqual(result.content, [{ type: 'text', text: JSON.stringify(result.value) }], 'Native projection must match the declared canonical output renderer');
    return result.value;
  };
  const content = { title: 'Real rc.3 board', tempo: 90, groups: [{ id: 'major', title: 'Major IV', chords: ['D', 'G', 'D'] }] };
  const checks = ['actual compatibility evaluator: rc.1 and rc.3 admitted; undeclared versions refused; old declaration rejected', 'Zod4 synchronous StandardSchema'];
  try {
    await ctx.plugin(SystemPrompt, {});
    await ctx.plugin(ToolsService, {});
    await ctx.plugin(native);
    assert.deepEqual(ctx.tools.schemas(), []);
    const invalidData = join(directory, 'invalid-config');
    await assert.rejects(async () => { await ctx.plugin({ ...plugin, name: 'tele-invalid-config' }, { dataDir: invalidData, port: -1 }); }, error => error.name === 'ValidationError');
    await assert.rejects(stat(invalidData), { code: 'ENOENT' });
    assert.deepEqual(ctx.tools.schemas(), []);
    checks.push('actual Cordis Config rejection occurs before creating data or registering a tool');
    fiber = ctx.plugin(plugin, { dataDir, port: 0 });
    await fiber;
    assert.deepEqual(ctx.tools.schemas().map(schema => schema.name), [plugin.BOARD_TOOL]);
    const definition = ctx.tools.get(plugin.BOARD_TOOL);
    assert.equal(definition.output.schema.type, 'object');
    assert.equal(definition.parameters.type, 'object');
    checks.push('real Cordis plugin startup, Config validation and raw Tools.register definition/schema projection');
    const catalogue = valueOf(await call({ action: 'catalogue', boardId: '', expectedRevision: 0, content: {} }));
    assert(catalogue.chords.some(chord => chord.symbol === 'Gm'));
    assert.deepEqual(valueOf(await call({ action: 'get', boardId: 'runtime-board' })), { boardId: 'runtime-board', exists: false, revision: 0 });
    const created = valueOf(await call({ action: 'put', boardId: 'runtime-board', expectedRevision: 0, content }));
    assert.equal(created.revision, 1);
    port = Number(new URL(created.url).port);
    assert(port > 0);
    assert.deepEqual(valueOf(await call({ action: 'get', boardId: 'runtime-board' })), created);
    const updated = valueOf(await call({ action: 'put', boardId: 'runtime-board', expectedRevision: 1, content: { ...content, title: 'Updated by real pipeline' } }));
    assert.equal(updated.revision, 2);
    const conflict = await call({ action: 'put', boardId: 'runtime-board', expectedRevision: 1, content: { ...content, title: 'Must not overwrite' } });
    assert.equal(conflict.isError, true);
    assert.match(conflict.error.message, /Revision conflict/);
    assert.deepEqual(valueOf(await call({ action: 'get', boardId: 'runtime-board' })), updated);
    checks.push('actual native pipeline catalogue/get/create/update/conflict with no overwrite');
    const invalid = await call({ action: 'put', boardId: 'runtime-board', expectedRevision: 2, content: { ...content, groups: [{ id: 'bad', title: 'Bad', chords: ['H'] }] } });
    assert.equal(invalid.isError, true);
    const controller = new AbortController();
    controller.abort(new Error('Runtime cancellation'));
    const cancelled = await call({ action: 'put', boardId: 'runtime-board', expectedRevision: 2, content }, controller.signal);
    assert.equal(cancelled.isError, true);
    assert.equal(cancelled.error.info.code, 'ABORTED_BEFORE_DISPATCH');
    assert.deepEqual(valueOf(await call({ action: 'get', boardId: 'runtime-board' })), updated);
    const token = (await readFile(join(dataDir, 'capability'), 'utf8')).trim();
    assert(!JSON.stringify([catalogue, created, updated, conflict, cancelled]).includes(token));
    checks.push('invalid arguments and pre-dispatch cancellation do not commit; no capability leaks');
    const origin = new URL(created.url).origin;
    assert.deepEqual(await (await fetch(`${origin}/api/capabilities`, { signal: AbortSignal.timeout(5000) })).json(), { chat: false, chatPanel: false });
    for (const file of plugin.PUBLIC_FILES) {
      const response = await fetch(file === 'index.html' ? created.url : `${origin}/${file}`, { signal: AbortSignal.timeout(5000) });
      assert.equal(response.status, 200);
      assert((await response.arrayBuffer()).byteLength > 0);
    }
    const sse = await fetch(`${origin}/api/boards/runtime-board/events`, { signal: AbortSignal.timeout(5000) });
    reader = sse.body.getReader();
    assert.equal((await reader.read()).done, false);
    const latest = valueOf(await call({ action: 'put', boardId: 'runtime-board', expectedRevision: 2, content: { ...content, title: 'SSE through real pipeline' } }));
    assert.equal(latest.revision, 3);
    assert.match(new TextDecoder().decode((await reader.read()).value), /"revision":3/);
    checks.push('built production assets and real pipeline SSE update');
    await fiber.dispose();
    assert.equal((await reader.read()).done, true);
    reader.releaseLock(); reader = undefined;
    assert.deepEqual(ctx.tools.schemas(), []);
    assert.equal(ctx.tools.get(plugin.BOARD_TOOL), undefined);
    const unknown = await call({ action: 'catalogue' });
    assert.equal(unknown.isError, true);
    assert.equal(unknown.error.info.code, 'UNKNOWN_TOOL');
    await assert.rejects(stat(join(dataDir, 'server.lock')), { code: 'ENOENT' });
    await assert.rejects(fetch(`${origin}/api/capabilities`, { signal: AbortSignal.timeout(3000) }));
    const listener = createServer();
    try { await new Promise((resolve, reject) => { listener.once('error', reject); listener.listen(port, '127.0.0.1', resolve); }); }
    finally { await new Promise((resolve, reject) => listener.close(error => error ? reject(error) : resolve())); }
    checks.push('awaited async Cordis disposal removes tool, closes SSE and port, releases data lock');
    fiber = ctx.plugin(plugin, { dataDir, port: 0 });
    await fiber;
    const restored = valueOf(await call({ action: 'get', boardId: 'runtime-board' }));
    assert.equal(restored.revision, latest.revision);
    assert.deepEqual(restored.content, latest.content);
    assert.equal((await readFile(join(dataDir, 'capability'), 'utf8')).trim(), token);
    await fiber.dispose();
    await assert.rejects(stat(join(dataDir, 'server.lock')), { code: 'ENOENT' });
    checks.push('reactivation restores board revision/content and capability without rewriting saved data');
    return { ok: true, mode: 'real-runtime', versions, declaredDsh: manifest.engines.dsh, manifestVersion: manifest.version, checks, modelRequests: 0, userProfileWrites: 0, limitations: ['isolated service composition, not the running user profile or GUI', 'rc.1 admission tested by rc.3 evaluator; this run does not execute an rc.1 runtime'] };
  } finally {
    if (reader) await reader.cancel().catch(() => {});
    await ctx.fiber.dispose();
    await rm(directory, { recursive: true, force: true });
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (!options.runtimeChild) {
    const invocation = runtimeInvocation(process.env, process.argv.slice(2));
    const result = spawnSync(invocation.executable, invocation.args, { cwd: root, env: invocation.env, stdio: 'inherit', timeout: 90000 });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
    return;
  }
  assert.equal(process.env.ELECTRON_RUN_AS_NODE, '1');
  const originalFetch = globalThis.fetch;
  let loopbackFetchRequests = 0;
  globalThis.fetch = (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    assert.equal(url.hostname, '127.0.0.1', 'Runtime verification must not send external or model fetch requests');
    assert.equal(url.protocol, 'http:');
    loopbackFetchRequests++;
    return originalFetch(input, init);
  };
  try {
    const report = await verifyRuntime(options);
    process.stdout.write(`${JSON.stringify({ ...report, loopbackFetchRequests, externalFetchRequests: 0 })}\n`);
  } finally { globalThis.fetch = originalFetch; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
