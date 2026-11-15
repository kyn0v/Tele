import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { test } from 'node:test';
import { parseArguments, runtimeInvocation } from '../scripts/verify-dsh-runtime.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const script = fileURLToPath(new URL('../scripts/verify-dsh-runtime.mjs', import.meta.url));

// These tests validate the launcher boundary only; no fake Cordis/Tools exist.
// The opt-in test below executes the real installed rc.3 runtime end to end.
test('runtime invocation requires an explicit absolute DSH executable and installation anchor', () => {
  assert.throws(() => runtimeInvocation({}), /DSH_NODE_EXECUTABLE/);
  assert.throws(() => runtimeInvocation({ DSH_NODE_EXECUTABLE: 'node', DSH_INSTALL_DIR: '/installed/dsh' }), /DSH_NODE_EXECUTABLE/);
  assert.throws(() => runtimeInvocation({ DSH_NODE_EXECUTABLE: '/installed/electron' }), /DSH_INSTALL_DIR/);
  assert.throws(() => runtimeInvocation({ DSH_NODE_EXECUTABLE: '/installed/electron', DSH_INSTALL_DIR: 'relative' }), /DSH_INSTALL_DIR/);
  const invocation = runtimeInvocation({ DSH_NODE_EXECUTABLE: '/installed/electron', DSH_INSTALL_DIR: '/installed/dsh' }, ['--expect-incompatible']);
  assert.equal(invocation.executable, '/installed/electron');
  assert.deepEqual(invocation.args, [script, '--runtime-child', '--expect-incompatible']);
  assert.equal(invocation.env.ELECTRON_RUN_AS_NODE, '1');
});

test('runtime CLI accepts explicit negative-control refs and refuses malformed or repeated arguments', () => {
  assert.deepEqual(parseArguments([]), { expectIncompatible: false, manifestRef: undefined, runtimeChild: false });
  assert.deepEqual(parseArguments(['--expect-incompatible', '--manifest-ref', 'v0.2.0']), { expectIncompatible: true, manifestRef: 'v0.2.0', runtimeChild: false });
  for (const args of [['--unknown'], ['--manifest-ref'], ['--manifest-ref', '-bad'], ['--manifest-ref', 'has spaces'], ['--expect-incompatible', '--expect-incompatible'], ['--runtime-child', '--runtime-child']]) {
    assert.throws(() => parseArguments(args));
  }
});

test('runtime launcher fails closed instead of falling back to PATH node when installation facts are absent', () => {
  const env = { ...process.env };
  delete env.DSH_NODE_EXECUTABLE;
  delete env.DSH_INSTALL_DIR;
  const result = spawnSync(process.execPath, [script], { cwd: root, env, encoding: 'utf8', timeout: 10000 });
  assert.ifError(result.error);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Set DSH_NODE_EXECUTABLE/);
});

const runtimeSkip = process.env.TELE_DSH_RUNTIME_TEST !== '1'
  ? 'Set TELE_DSH_RUNTIME_TEST=1 to request installed DSH verification'
  : !process.env.DSH_NODE_EXECUTABLE || !isAbsolute(process.env.DSH_NODE_EXECUTABLE) || !process.env.DSH_INSTALL_DIR || !isAbsolute(process.env.DSH_INSTALL_DIR)
    ? 'Installed DSH executable and package anchor are not supplied; no fake runtime substitute'
    : !existsSync(join(root, 'dist/dsh-extension.js'))
      ? 'Production dist is absent; build separately before running installed-runtime verification'
      : false;

test('actual installed rc.3 runtime validates published old refusal and current real pipeline/lifecycle', {
  skip: runtimeSkip,
  timeout: 120000,
}, () => {
  const run = args => {
    const result = spawnSync(process.execPath, [script, ...args], { cwd: root, env: process.env, encoding: 'utf8', timeout: 90000, maxBuffer: 2 * 1024 * 1024 });
    assert.ifError(result.error);
    return result;
  };
  const old = run(['--expect-incompatible', '--manifest-ref', 'v0.2.0']);
  assert.equal(old.status, 0, old.stderr);
  const oldReport = JSON.parse(old.stdout.trim());
  assert.equal(oldReport.mode, 'expected-incompatible');
  assert.equal(oldReport.manifestVersion, '0.2.0');
  assert.equal(oldReport.runtime, '0.2.2-rc.3');
  assert.equal(oldReport.pluginExecuted, false);
  assert.deepEqual(oldReport.requirements, { 'engines.dsh': '0.2.2-rc.1' });

  const falseNegative = run(['--expect-incompatible']);
  assert.notEqual(falseNegative.status, 0, 'Updated current manifest must not be reported as incompatible');
  assert.match(falseNegative.stderr, /Expected an actual incompatibility refusal/);

  const current = run([]);
  assert.equal(current.status, 0, current.stderr);
  const report = JSON.parse(current.stdout.trim());
  assert.equal(report.ok, true);
  assert.equal(report.mode, 'real-runtime');
  assert.equal(report.versions.dsh, '0.2.2-rc.3');
  assert.equal(report.versions.tools, '0.2.2-rc.3');
  assert.equal(report.versions.executor, '0.2.2-rc.3');
  assert.equal(report.versions.cordis, '4.1.0');
  assert.equal(report.externalFetchRequests, 0);
  assert(report.loopbackFetchRequests > 0);
  assert(report.checks.some(check => check.includes('actual native pipeline')));
  assert(report.checks.some(check => check.includes('awaited async Cordis disposal')));
  assert(report.checks.some(check => check.includes('reactivation restores')));
});
