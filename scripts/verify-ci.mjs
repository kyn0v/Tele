import assert from 'node:assert/strict';
import { lstat, mkdtemp, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { closeOwnedCommands, runCommand } from './package-command.mjs';
import { artifactDirectory } from './release.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

async function requireAbsent(path, message) {
  try { await lstat(path); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  throw new Error(message);
}

export async function verifyCi({ cwd = root, artifactDir, env = process.env } = {}) {
  assert(process.platform !== 'win32', 'Verification requires a POSIX host');
  if (artifactDir) assert(isAbsolute(artifactDir), 'Artifact directory must be absolute');
  const browsers = env.PLAYWRIGHT_BROWSERS_PATH ?? join(tmpdir(), 'tele-playwright');
  assert(isAbsolute(browsers), 'PLAYWRIGHT_BROWSERS_PATH must be absolute');
  await requireAbsent(join(cwd, 'dist'), 'verify:ci requires a fresh checkout without dist. It does not delete build output.');
  if (artifactDir) await requireAbsent(artifactDir, 'Artifact directory must not already exist');
  const commandEnv = { ...env, PLAYWRIGHT_BROWSERS_PATH: browsers };
  let staging;
  async function run(file, args) {
    console.log(`> ${file} ${args.join(' ')}`);
    try {
      const output = await runCommand(file, args, { cwd, env: commandEnv, timeout: 600_000, maxBuffer: 16 * 1024 * 1024 });
      process.stdout.write(output.stdout); process.stderr.write(output.stderr);
    } catch (error) {
      process.stdout.write(error.stdout ?? ''); process.stderr.write(error.stderr ?? '');
      throw error;
    }
  }
  try {
    if (artifactDir) staging = await mkdtemp(join(dirname(artifactDir), '.tele-verified-'));
    await run('npm', ['run', 'verify:extension']);
    await run('npm', ['test']);
    await run('npm', ['run', 'build']);
    await run(process.execPath, [join(cwd, 'node_modules/playwright/cli.js'), 'install', 'chromium', '--only-shell',
      ...(process.platform === 'linux' && env.GITHUB_ACTIONS === 'true' ? ['--with-deps'] : [])]);
    await run('npm', ['run', 'verify:package', ...(staging ? ['--', '--artifact-dir', join(staging, 'artifact')] : [])]);
    await run('npm', ['run', 'verify:chat:probe']);
    await run('npm', ['run', 'verify:browser']);
    await closeOwnedCommands();
    if (staging) await rename(join(staging, 'artifact'), artifactDir);
  } finally {
    try { await closeOwnedCommands(); }
    finally { if (staging) await rm(staging, { recursive: true, force: true }); }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  Promise.resolve().then(() => verifyCi({ artifactDir: artifactDirectory(process.argv.slice(2)) }))
    .catch(error => { console.error(error); process.exitCode = 1; });
}
