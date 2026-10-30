import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { startServer } from '../src/server.js';
import { BoardSchema } from '../src/schema.js';
import { z } from 'zod';
const PutResultSchema = BoardSchema.extend({ url: z.url() });

const exec = promisify(execFile);
const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const major = fileURLToPath(new URL('../examples/major.json', import.meta.url));
const comparison = fileURLToPath(new URL('../examples/comparison.json', import.meta.url));

test('CLI uses the real HTTP service from a different cwd, updates one URL and reports conflicts', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'audioharness-cli-'));
  const server = await startServer({ dataDir, port: 0 });
  t.after(async () => { await server.stop(); await rm(dataDir, { recursive: true, force: true }); });
  const run = (...args: string[]) => exec(process.execPath, ['--import', import.meta.resolve('tsx'), cli, ...args], {
    cwd: tmpdir(), env: { ...process.env, AUDIOHARNESS_DATA: dataDir, AUDIOHARNESS_PORT: String(server.port) },
  });
  const created = PutResultSchema.parse(JSON.parse((await run('put', 'harmony', '--expect', '0', '--file', major)).stdout));
  assert.equal(created.id, 'harmony'); assert.equal(created.revision, 1);
  const current = BoardSchema.parse(JSON.parse((await run('get', 'harmony')).stdout));
  assert.deepEqual(current.content.groups[0]?.chords, ['D', 'G', 'D']);
  const updated = PutResultSchema.parse(JSON.parse((await run('put', 'harmony', '--expect', '1', '--file', comparison)).stdout));
  assert.equal(updated.url, created.url); assert.equal(updated.revision, 2);
  assert.deepEqual(updated.content.groups[1]?.chords, ['D', 'Gm', 'D']);
  assert.equal(z.object({ chords: z.array(z.unknown()) }).parse(JSON.parse((await run('catalogue')).stdout)).chords.length, 14);
  await assert.rejects(run('put', 'harmony', '--expect', '1', '--file', major), error => error instanceof Error && 'stderr' in error && typeof error.stderr === 'string' && error.stderr.includes('"status":409'));
  await assert.rejects(run('put', 'new', '--file', major), /Usage/);
  const invalid = join(dataDir, 'invalid.json');
  await writeFile(invalid, JSON.stringify({ title: 'Bad', groups: [{ id: 'a', title: 'Bad', chords: ['H'] }] }));
  await assert.rejects(run('put', 'invalid', '--expect', '0', '--file', invalid), /Invalid option/);
  assert.equal((await fetch(`${server.url}/api/boards/invalid`)).status, 404);
});
