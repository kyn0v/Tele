import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const lock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'));

test('DSH manifest explicitly declares both reviewed rc.1 and rc.3 releases', () => {
  assert.deepEqual(manifest.engines.dsh.split(/\s*\|\|\s*/), ['0.2.2-rc.1', '0.2.2-rc.3']);
});

test('lockfile preserves the same DSH requirement and package version', () => {
  assert.equal(lock.packages[''].engines.dsh, manifest.engines.dsh);
  assert.equal(lock.version, manifest.version);
  assert.equal(lock.packages[''].version, manifest.version);
});

test('compatibility update preserves the Pi and DSH package entrypoints', () => {
  assert.deepEqual(manifest.pi.extensions, ['./dist/pi-extension.js']);
  assert.equal(manifest.exports['.'], './dist/dsh-extension.js');
  assert.equal(manifest.exports['./pi'], './dist/pi-extension.js');
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml');
  for (const hook of ['preinstall', 'install', 'postinstall']) assert.equal(manifest.scripts[hook], undefined);
});
