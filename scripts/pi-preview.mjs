import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../', import.meta.url));
export function previewPi({ directory, model, extensions = [], persist = false, tools = model ? 'audioharness_board' : 'read,audioharness_board', offline = false }) {
  const args = [fileURLToPath(new URL('../node_modules/@earendil-works/pi-coding-agent/dist/cli.js', import.meta.url)),
    '--mode', 'rpc', '--no-extensions', '--no-skills', '--no-prompt-templates', '--no-context-files', '--no-mcp', '--no-themes',
    '--tools', tools, '-e', `${root}dist/pi-extension.js`, '--audioharness-port', '0', '--audioharness-data', `${directory}/boards`,
    ...(persist ? ['--session-dir', `${directory}/sessions`] : ['--no-session']),
    ...(model ? ['--model', model, '--thinking', 'low'] : []),
    ...(offline || !model ? ['--offline'] : []),
    ...extensions.flatMap(path => ['-e', path])];
  const child = spawn(process.execPath, args, { cwd: directory, stdio: ['pipe', 'pipe', 'pipe'] });
  const listeners = new Set();
  const pending = new Map();
  let partial = '';
  let errors = '';
  child.stderr.on('data', chunk => { errors = (errors + String(chunk)).slice(-4000); });
  child.stdout.on('data', chunk => {
    partial += String(chunk);
    let boundary;
    while ((boundary = partial.indexOf('\n')) >= 0) {
      const line = partial.slice(0, boundary); partial = partial.slice(boundary + 1);
      let record;
      try { record = JSON.parse(line); } catch { continue; }
      if (record.type === 'response' && pending.has(record.id)) {
        const { resolve, reject, timer } = pending.get(record.id); pending.delete(record.id); clearTimeout(timer);
        record.success ? resolve(record.data) : reject(new Error(record.error));
      }
      for (const listener of listeners) listener(record);
    }
  });
  child.on('exit', code => {
    for (const { reject, timer } of pending.values()) { clearTimeout(timer); reject(new Error(`Preview Pi exited ${code}. ${errors}`)); }
    pending.clear();
  });
  const command = (type, data = {}) => new Promise((resolve, reject) => {
    const id = randomUUID();
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Pi ${type} timeout. ${errors}`)); }, 30_000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(`${JSON.stringify({ id, type, ...data })}\n`);
  });
  const wait = (predicate, timeout = 30_000) => new Promise((resolve, reject) => {
    const listener = record => { if (predicate(record)) { clearTimeout(timer); listeners.delete(listener); resolve(record); } };
    const timer = setTimeout(() => { listeners.delete(listener); reject(new Error('Preview Pi event timeout')); }, timeout);
    listeners.add(listener);
  });
  return {
    command, wait,
    respondUI(record) { child.stdin.write(`${JSON.stringify({ type: 'extension_ui_response', ...record })}\n`); },
    observe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async attach(board = 'preview') {
      const invitation = wait(record => record.type === 'extension_ui_request' && record.method === 'notify' && record.message?.includes('#chat='));
      await command('prompt', { message: `/audioharness ${board}` });
      const notice = await invitation;
      const url = notice.message.match(/http:\/\/127\.0\.0\.1:\d+\/b\/[^\s]+/u)?.[0];
      if (!url) throw new Error('No pairing invitation');
      return url;
    },
    async close() {
      if (child.exitCode !== null) return;
      const exited = once(child, 'exit');
      child.stdin.end();
      const timer = setTimeout(() => child.kill('SIGTERM'), 5000);
      await exited; clearTimeout(timer);
    },
  };
}
