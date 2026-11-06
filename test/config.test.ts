import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { configuration } from '../src/config.js';

test('default data survives package replacement in the user home', () => {
  assert.equal(configuration({}).dataDir, join(homedir(), '.tele'));
  assert.equal(configuration({}).port, 4317);
});

test('explicit absolute and cwd-relative data directories remain supported', () => {
  const absolute = join(homedir(), 'tele-custom');
  assert.equal(configuration({ TELE_DATA: absolute }).dataDir, absolute);
  assert.equal(configuration({ TELE_DATA: 'boards/local' }).dataDir, resolve('boards/local'));
});

test('ports accept integers from 1 through 65535 and reject invalid values', () => {
  for (const port of ['1', '4320', '65535']) {
    assert.equal(configuration({ TELE_PORT: port }).port, Number(port));
  }
  for (const port of ['0', '-1', '65536', '1.5', 'not-a-port', '']) {
    assert.throws(() => configuration({ TELE_PORT: port }));
  }
});
