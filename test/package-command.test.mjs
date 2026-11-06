import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { runCommand } from '../scripts/package-command.mjs';

const posix = process.platform !== 'win32';
const helper = new URL('../scripts/package-command.mjs', import.meta.url).href;
const ownGroup = posix ? Number(execFileSync('ps', ['-o', 'pgid=', '-p', String(process.pid)])) : undefined;
function alive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; throw error; }
}
function killGroup(group) {
  assert(group > 0 && group !== ownGroup, 'Only the fixture group may be killed');
  try { process.kill(-group, 'SIGKILL'); }
  catch (error) { if (error.code !== 'ESRCH') throw error; }
}

test('commands preserve stdout, stderr, and numeric nonzero exit codes', { skip: !posix }, async () => {
  const script = 'process.stdout.write("output"); process.stderr.write("diagnostic");';
  assert.deepEqual(await runCommand(process.execPath, ['-e', script], { timeout: 5000 }), {
    stdout: 'output', stderr: 'diagnostic',
  });
  await assert.rejects(runCommand(process.execPath, ['-e', `${script} process.exitCode = 7;`], { timeout: 5000 }), error => {
    assert.equal(error.code, 7);
    assert.equal(error.stdout, 'output');
    assert.equal(error.stderr, 'diagnostic');
    return true;
  });
});

test('spawn errors preserve their error codes', { skip: !posix }, async () => {
  await assert.rejects(runCommand('__tele_nonexistent_command__', []), { code: 'ENOENT', stdout: '', stderr: '' });
});

for (const mode of ['success', 'nonzero', 'overflow']) {
  test(`${mode} closes a background descendant before settling`, { skip: !posix, timeout: 10_000 }, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tele-command-'));
    const marker = join(directory, 'child.pid');
    let pid;
    try {
      const script = `
        const { spawn } = require('node:child_process');
        const { writeFileSync } = require('node:fs');
        const child = spawn(process.execPath, ['-e',
          'process.on("SIGTERM", () => {}); process.send("ready"); setInterval(() => {}, 1000);'], {
          stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        });
        child.once('message', () => {
          writeFileSync(${JSON.stringify(marker)}, String(child.pid));
          child.disconnect(); child.unref();
          process.stdout.write('output'); process.stderr.write('diagnostic');
          ${mode === 'overflow' ? "process.stdout.write('x'.repeat(4096)); setInterval(() => {}, 1000);" : `process.exitCode = ${mode === 'nonzero' ? 7 : 0};`}
        });
      `;
      const command = runCommand(process.execPath, ['-e', script], { timeout: 5000, maxBuffer: 1024 });
      if (mode === 'success') {
        assert.deepEqual(await command, { stdout: 'output', stderr: 'diagnostic' });
      } else {
        await assert.rejects(command, error => {
          assert.equal(error.code, mode === 'nonzero' ? 7 : 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER', error.stack);
          assert.equal(error.stderr, 'diagnostic');
          if (mode === 'overflow') assert.equal(Buffer.byteLength(error.stdout), 1024);
          else assert.equal(error.stdout, 'output');
          return true;
        });
      }
      pid = Number(await readFile(marker, 'utf8'));
      assert.equal(alive(pid), false, 'A settled command must not leave its background descendant running');
    } finally {
      try { pid ??= Number(await readFile(marker, 'utf8')); } catch {}
      if (pid && alive(pid)) process.kill(pid, 'SIGKILL');
      await rm(directory, { recursive: true, force: true });
    }
  });
}

for (const stop of ['timeout', 'SIGINT', 'SIGTERM']) {
  test(`${stop} closes a real stalled npm prepack build before rejecting`, { skip: !posix, timeout: 20_000 }, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tele-command-'));
    let driver;
    let build;
    try {
      const marker = join(directory, 'build.json');
      await writeFile(join(directory, 'package.json'), JSON.stringify({
        name: 'tele-command-fixture', version: '1.0.0', type: 'module',
        scripts: { prepack: 'npm run build', build: 'node stall.mjs' },
      }));
      await writeFile(join(directory, 'stall.mjs'), `
        import { writeFileSync } from 'node:fs';
        import { execFileSync } from 'node:child_process';
        writeFileSync(${JSON.stringify(marker)}, JSON.stringify({
          pid: process.pid, group: Number(execFileSync('ps', ['-o', 'pgid=', '-p', String(process.pid)])),
        }));
        process.on('SIGTERM', () => {});
        setInterval(() => {}, 1000);
      `);
      await writeFile(join(directory, 'driver.mjs'), `
        import { runCommand } from ${JSON.stringify(helper)};
        try {
          await runCommand('npm', ['pack', '--json', '--ignore-scripts=false'], {
            cwd: ${JSON.stringify(directory)}, timeout: 3000, maxBuffer: 1024 * 1024,
            env: { ...process.env, npm_config_cache: ${JSON.stringify(join(directory, 'npm-cache'))} },
          });
          process.stdout.write(JSON.stringify({ rejected: false }));
        } catch (error) {
          process.stdout.write(JSON.stringify({ rejected: true, code: error.code }));
        }
      `);
      driver = spawn(process.execPath, [join(directory, 'driver.mjs')], {
        detached: true, stdio: ['ignore', 'pipe', 'pipe'], timeout: 15_000,
      });
      let stdout = '';
      let stderr = '';
      driver.stdout.on('data', chunk => { stdout += chunk; });
      driver.stderr.on('data', chunk => { stderr += chunk; });
      const closed = once(driver, 'close');
      if (stop !== 'timeout') {
        const deadline = Date.now() + 5000;
        while (!existsSync(marker)) {
          assert(Date.now() < deadline, 'Stalled build must start before interrupting');
          await delay(20);
        }
        driver.kill(stop);
      }
      const [code, signal] = await closed;
      build = JSON.parse(await readFile(marker, 'utf8'));
      assert.equal(alive(build.pid), false, 'Settled npm pack must not leave the prepack build running');
      assert.equal(code, 0, `Driver must finish, signal=${signal}, stderr=${stderr}`);
      const result = JSON.parse(stdout);
      assert.equal(result.rejected, true, 'Stalled pack must reject');
      assert.equal(result.code, stop === 'timeout' ? 'ETIMEDOUT' : stop);
    } finally {
      try { build ??= JSON.parse(await readFile(join(directory, 'build.json'), 'utf8')); } catch {}
      if (build && alive(build.pid)) killGroup(build.group);
      if (driver?.pid) killGroup(driver.pid);
      await rm(directory, { recursive: true, force: true });
    }
  });
}
