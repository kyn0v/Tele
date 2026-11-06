import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { artifactDirectory } from '../scripts/release.mjs';
import { verifyCi } from '../scripts/verify-ci.mjs';

const order = ['extension', 'test', 'build', 'chromium', 'package', 'probe', 'browser'];
const bytes = Buffer.from([31, 139, 0, 255, 13, 10]);

async function fixture(t, failure) {
  const cwd = await mkdtemp(join(tmpdir(), 'tele-gate-test-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const log = join(cwd, 'commands.jsonl');
  const artifactDir = join(cwd, 'exported');
  await mkdir(join(cwd, 'node_modules/playwright'), { recursive: true });
  await writeFile(join(cwd, 'step.mjs'), `
    import { appendFile, mkdir, writeFile } from 'node:fs/promises';
    import { join } from 'node:path';
    const step = process.argv[2];
    await appendFile(${JSON.stringify(log)}, JSON.stringify({ step, browsers: process.env.PLAYWRIGHT_BROWSERS_PATH }) + '\\n');
    if (step === 'build') await mkdir('dist');
    if (step === 'package' && process.argv[3] === '--artifact-dir') {
      await mkdir(process.argv[4]);
      await writeFile(join(process.argv[4], 'tested.tgz'), Buffer.from(${JSON.stringify([...bytes])}));
      await writeFile(join(process.argv[4], 'metadata.json'), '{}');
    }
    if (step === ${JSON.stringify(failure ?? '')}) process.exitCode = 7;
  `);
  await writeFile(join(cwd, 'node_modules/playwright/cli.js'), `import { spawnSync } from 'node:child_process';
    const result = spawnSync(process.execPath, ['step.mjs', 'chromium'], { stdio: 'inherit' }); process.exitCode = result.status;`);
  await writeFile(join(cwd, 'package.json'), JSON.stringify({
    private: true, type: 'module', scripts: {
      'verify:extension': 'node step.mjs extension', test: 'node step.mjs test', build: 'node step.mjs build',
      'verify:package': 'node step.mjs package', 'verify:chat:probe': 'node step.mjs probe',
      'verify:browser': 'node step.mjs browser', 'verify:chat:browser': 'node step.mjs paid-model-must-not-run',
    },
  }));
  return { cwd, log, artifactDir, env: { ...process.env, GITHUB_ACTIONS: 'false', PLAYWRIGHT_BROWSERS_PATH: join(cwd, 'browsers') } };
}

test('artifact argument parsing requires exactly one absolute destination', () => {
  assert.equal(artifactDirectory([]), undefined);
  assert.equal(artifactDirectory(['--artifact-dir', '/tmp/tele-artifact']), '/tmp/tele-artifact');
  for (const args of [['--artifact-dir'], ['--unknown', '/tmp/out'], ['--artifact-dir', 'relative'], ['--artifact-dir', '/tmp/out', 'extra']]) {
    assert.throws(() => artifactDirectory(args), /Usage/);
  }
});

test('shared gate runs only no-model checks and exposes unchanged staged bytes only on success', async t => {
  const options = await fixture(t);
  await verifyCi(options);
  const entries = (await readFile(options.log, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(entries.map(entry => entry.step), order);
  assert(entries.every(entry => entry.browsers === options.env.PLAYWRIGHT_BROWSERS_PATH));
  assert.deepEqual(await readFile(join(options.artifactDir, 'tested.tgz')), bytes);
  assert.deepEqual((await readdir(options.cwd)).filter(file => file.startsWith('.tele-verified-')), []);
});

test('a later browser failure removes staged artifacts and never exposes the final output', async t => {
  const options = await fixture(t, 'browser');
  await assert.rejects(verifyCi(options), error => error.code === 7);
  assert.equal(existsSync(options.artifactDir), false);
  assert.deepEqual((await readdir(options.cwd)).filter(file => file.startsWith('.tele-verified-')), []);
  const steps = (await readFile(options.log, 'utf8')).trim().split('\n').map(line => JSON.parse(line).step);
  assert.deepEqual(steps, order, 'The package was checked before the downstream failure');
});

test('fresh-checkout, cache path, and output guards fail before starting commands without deleting files', async t => {
  const options = await fixture(t);
  await assert.rejects(verifyCi({ ...options, env: { ...options.env, PLAYWRIGHT_BROWSERS_PATH: 'relative' } }), /must be absolute/);
  await mkdir(join(options.cwd, 'dist'));
  await writeFile(join(options.cwd, 'dist/keep'), 'owner output');
  await assert.rejects(verifyCi(options), /fresh checkout/);
  assert.equal(await readFile(join(options.cwd, 'dist/keep'), 'utf8'), 'owner output');
  await rm(join(options.cwd, 'dist'), { recursive: true });
  await mkdir(options.artifactDir);
  await writeFile(join(options.artifactDir, 'keep'), 'owner artifact');
  await assert.rejects(verifyCi(options), /must not already exist/);
  assert.equal(await readFile(join(options.artifactDir, 'keep'), 'utf8'), 'owner artifact');
  assert.equal(existsSync(options.log), false);
});
