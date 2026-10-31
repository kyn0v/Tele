import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
assert(!existsSync(join(root, 'dist')), 'Run this check in a fresh checkout before building');
const directory = mkdtempSync(join(tmpdir(), 'tele-source-load-'));
try {
  const args = [join(root, 'node_modules/@earendil-works/pi-coding-agent/dist/cli.js'),
    '--mode', 'rpc', '--approve', '--no-skills', '--no-context-files', '--no-prompt-templates', '--no-themes', '--no-mcp',
    '--no-session', '--offline', '--tools', 'read,tele_board', '--tele-port', '0', '--tele-data', join(directory, 'boards')];
  const result = spawnSync(process.execPath, args, {
    cwd: root, env: { ...process.env, PI_CODING_AGENT_DIR: join(directory, 'agent'), PI_TELEMETRY: '0' },
    input: '{"id":"source-load","type":"get_commands"}\n', encoding: 'utf8', timeout: 30_000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  const records = result.stdout.split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line));
  const response = records.find(record => record.type === 'response' && record.id === 'source-load');
  assert(response?.success, JSON.stringify(records));
  const command = response.data.commands.find(command => command.name === 'tele');
  assert.equal(command?.sourceInfo?.path, join(root, '.pi/extensions/tele.js'));
  assert.equal(command.sourceInfo.scope, 'project');
  assert.equal(command.sourceInfo.source, 'auto');
  assert(!existsSync(join(root, 'dist')), 'Extension discovery must not generate dist');
  process.stdout.write(`${JSON.stringify({ distAbsent: true, explicitExtensionFlag: false, command: command.name, source: command.sourceInfo.source, scope: command.sourceInfo.scope, status: result.status }, null, 2)}\n`);
} finally { rmSync(directory, { recursive: true, force: true }); }
