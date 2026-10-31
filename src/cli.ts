import { spawn } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { configuration } from './config.js';
import { BoardIdSchema, BoardSchema, ContentSchema, MAX_BODY_BYTES, RevisionSchema } from './schema.js';

const usage = `Usage:
  npm run board -- put <id> --expect <revision> --file <content.json> [--open]
  npm run board -- get <id>
  npm run board -- catalogue
Set TELE_DATA and TELE_PORT for a non-default server.`;
const PutResultSchema = BoardSchema.extend({ url: z.url() });

function openBrowser(url: string) {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'rundll32' : 'xdg-open';
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  const child = spawn(command, args, { stdio: 'ignore', detached: true });
  child.on('error', (error: Error) => process.stderr.write(`Board saved. Browser launch failed: ${error.message}\n`));
  child.on('exit', code => { if (code) process.stderr.write(`Board saved. Browser launcher exited ${code}. Open ${url}\n`); });
  child.unref();
}

try {
  const { port, dataDir } = configuration();
  const [command, ...args] = process.argv.slice(2);
  const base = `http://127.0.0.1:${port}`;
  let response: Response;
  let open = false;
  if (command === 'catalogue' && args.length === 0) {
    response = await fetch(`${base}/api/catalogue`, { signal: AbortSignal.timeout(10_000) });
  } else if (command === 'get' && args.length === 1) {
    const id = BoardIdSchema.parse(args[0]);
    response = await fetch(`${base}/api/boards/${id}`, { signal: AbortSignal.timeout(10_000) });
  } else if (command === 'put') {
    const [rawId, ...flags] = args;
    const id = BoardIdSchema.parse(rawId);
    let file: string | undefined;
    let revision: number | undefined;
    const seen = new Set<string>();
    for (let index = 0; index < flags.length; index++) {
      const flag = flags[index];
      if (flag === undefined || seen.has(flag)) throw new Error(usage);
      seen.add(flag);
      if (flag === '--open') { open = true; continue; }
      const value = flags[++index];
      if (!value || value.startsWith('--')) throw new Error(usage);
      if (flag === '--file') file = value;
      else if (flag === '--expect' && /^(0|[1-9][0-9]*)$/.test(value)) revision = Number(value);
      else throw new Error(usage);
    }
    if (!file || revision === undefined) throw new Error(usage);
    const expected = RevisionSchema.parse(revision);
    if (statSync(file).size > MAX_BODY_BYTES) throw new Error(`Input file exceeds ${MAX_BODY_BYTES} bytes`);
    const content = ContentSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
    const body = JSON.stringify(content);
    if (Buffer.byteLength(body) > MAX_BODY_BYTES) throw new Error(`Content exceeds ${MAX_BODY_BYTES} bytes`);
    const token = readFileSync(join(dataDir, 'capability'), 'utf8').trim();
    if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('Invalid local capability file');
    response = await fetch(`${base}/api/boards/${id}`, {
      method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'If-Match': `"${expected}"` },
      body, signal: AbortSignal.timeout(10_000),
    });
  } else throw new Error(usage);
  const result: unknown = await response.json();
  if (!response.ok) {
    process.stderr.write(`${JSON.stringify({ status: response.status, ...z.record(z.string(), z.unknown()).parse(result) })}\n`);
    process.exitCode = 1;
  } else {
    if (command === 'get') BoardSchema.parse(result);
    if (command === 'put') {
      const saved = PutResultSchema.parse(result);
      if (open) openBrowser(saved.url);
    }
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'Command failed'}\n`);
  process.exitCode = 1;
}
