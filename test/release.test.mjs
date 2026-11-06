import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { appendFile, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { runCommand } from '../scripts/package-command.mjs';
import { exportArtifact, preflight, publishArtifact, registryVersion, releaseIdentity, validateVersions, verifyArtifact } from '../scripts/release.mjs';

const name = '@kyn0v/pi-tele';
const version = '0.2.0';
const commit = 'a'.repeat(40);
const expected = { version, commit };
const integrity = `sha512-${Buffer.alloc(64, 1).toString('base64')}`;
const manifest = { name, version };
const lock = { name, version, packages: { '': manifest } };
const event = {
  action: 'published', repository: { full_name: 'kyn0v/Tele' },
  release: { tag_name: 'v0.2.0', draft: false, prerelease: false },
};

async function temporary(t) {
  const directory = await mkdtemp(join(tmpdir(), 'tele-release-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}
async function gitFixture(t) {
  const cwd = await temporary(t);
  const git = async (...args) => (await runCommand('git', args, { cwd, timeout: 5000 })).stdout.trim();
  await git('init', '-b', 'main');
  await git('config', 'user.email', 'fixture@example.invalid');
  await git('config', 'user.name', 'Release fixture');
  await git('config', 'commit.gpgsign', 'false');
  await git('config', 'tag.gpgsign', 'false');
  await writeFile(join(cwd, 'package.json'), JSON.stringify(manifest));
  await writeFile(join(cwd, 'package-lock.json'), JSON.stringify(lock));
  await git('add', '.');
  await git('commit', '-m', 'fixture');
  const sha = await git('rev-parse', 'HEAD');
  await git('update-ref', 'refs/remotes/origin/main', sha);
  await git('tag', '-a', 'v0.2.0', '-m', 'stable fixture');
  return { cwd, git, sha };
}
async function artifactFixture(t) {
  const cwd = await temporary(t);
  await mkdir(join(cwd, 'package'));
  await writeFile(join(cwd, 'package/package.json'), JSON.stringify(manifest));
  await writeFile(join(cwd, 'package/payload'), Buffer.from([0, 1, 255, 13, 10]));
  const tarball = join(cwd, 'kyn0v-pi-tele-0.2.0.tgz');
  await runCommand('tar', ['-czf', tarball, '-C', cwd, 'package'], { timeout: 5000 });
  const directory = join(cwd, 'artifact');
  const metadata = await exportArtifact(tarball, directory, commit);
  return { cwd, tarball, directory, metadata };
}
async function registryFixture(t, respond) {
  const paths = [];
  const server = createServer((request, response) => {
    paths.push(request.url);
    respond(request, response);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return { base: `http://127.0.0.1:${server.address().port}`, paths };
}
function reply(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(typeof body === 'string' ? body : JSON.stringify(body));
}
const registryBody = hash => ({ name, version, dist: { integrity: hash } });

test('stable release resolves an annotated tag to its immutable main ancestor', async t => {
  const { cwd, sha } = await gitFixture(t);
  assert.deepEqual(await preflight(event, 'release', 'kyn0v/Tele', cwd), { tag: 'v0.2.0', version, commit: sha });
});

test('release validation rejects wrong event, repository, action, drafts, prereleases, and noncanonical tags', () => {
  const identity = value => releaseIdentity(value, 'release', 'kyn0v/Tele');
  assert.deepEqual(identity(event), { tag: 'v0.2.0', version });
  assert.throws(() => releaseIdentity(event, 'workflow_dispatch', 'kyn0v/Tele'), /Only release/);
  assert.throws(() => releaseIdentity(event, 'release', 'someone/Tele'), /Unexpected repository/);
  assert.throws(() => identity({ ...event, repository: { full_name: 'someone/Tele' } }), /repository mismatch/);
  assert.throws(() => identity({ ...event, action: 'created' }), /must be published/);
  for (const release of [
    { ...event.release, draft: true }, { ...event.release, prerelease: true },
    ...['0.2.0', 'v01.2.0', 'v0.2.0-beta.1', 'v0.2.0+build', 'v0.2.0\n', 'v$(id)'].map(tag_name => ({ ...event.release, tag_name })),
  ]) assert.throws(() => identity({ ...event, release }));
});

test('package, lockfile, and lockfile root must all agree with the release identity', () => {
  validateVersions(manifest, lock, version);
  assert.throws(() => validateVersions({ ...manifest, name: 'other' }, lock, version), /package name/);
  assert.throws(() => validateVersions(manifest, lock, '0.3.0'), /Package version/);
  assert.throws(() => validateVersions(manifest, { ...lock, version: '0.1.0' }, version), /Lockfile version/);
  assert.throws(() => validateVersions(manifest, { ...lock, packages: { '': { name, version: '0.1.0' } } }, version), /root version/);
  assert.throws(() => validateVersions(manifest, { ...lock, name: 'other' }, version), /Lockfile name/);
});

test('preflight rejects missing tags, version mismatch, and a real commit outside main ancestry', async t => {
  const { cwd, git } = await gitFixture(t);
  const tagged = tag_name => ({ ...event, release: { ...event.release, tag_name } });
  await assert.rejects(preflight(tagged('v0.3.0'), 'release', 'kyn0v/Tele', cwd));
  await git('tag', 'v0.3.0');
  await assert.rejects(preflight(tagged('v0.3.0'), 'release', 'kyn0v/Tele', cwd), /Package version/);
  await git('checkout', '-b', 'unmerged');
  await writeFile(join(cwd, 'unmerged'), 'not on main');
  await git('add', '.'); await git('commit', '-m', 'unmerged');
  await git('tag', '-f', 'v0.2.0');
  await assert.rejects(preflight(event, 'release', 'kyn0v/Tele', cwd), error => error.code === 1);
});

test('artifact export preserves exact input bytes, validates tar manifest, and refuses an existing output', async t => {
  const { tarball, directory, metadata } = await artifactFixture(t);
  assert.deepEqual(await readdir(directory), ['kyn0v-pi-tele-0.2.0.tgz', 'metadata.json']);
  assert.deepEqual(await readFile(join(directory, metadata.filename)), await readFile(tarball));
  assert.equal(metadata.integrity, `sha512-${createHash('sha512').update(await readFile(tarball)).digest('base64')}`);
  assert.deepEqual(await verifyArtifact(directory, expected), metadata);
  await assert.rejects(exportArtifact(tarball, directory, commit), { code: 'EEXIST' });
  assert.deepEqual(await verifyArtifact(directory, expected), metadata, 'Existing artifact is not deleted or overwritten');
});

test('artifact validation rejects changed bytes, wrong release identity, extra files, and unsafe filename', async t => {
  const { directory, metadata } = await artifactFixture(t);
  await assert.rejects(verifyArtifact(directory, { ...expected, commit: 'b'.repeat(40) }), /commit mismatch/);
  await assert.rejects(verifyArtifact(directory, { ...expected, version: '0.3.0' }), /version mismatch/);
  await writeFile(join(directory, 'report.json'), '{}');
  await assert.rejects(verifyArtifact(directory, expected), /only tarball and metadata/);
  await rm(join(directory, 'report.json'));
  await writeFile(join(directory, 'metadata.json'), JSON.stringify({ ...metadata, filename: '../escape.tgz' }));
  await assert.rejects(verifyArtifact(directory, expected), /basename/);
  await writeFile(join(directory, 'metadata.json'), JSON.stringify(metadata));
  await appendFile(join(directory, metadata.filename), 'tamper');
  await assert.rejects(verifyArtifact(directory, expected), /integrity mismatch/);
});

test('a self-consistent digest cannot hide a different tar manifest', async t => {
  const { cwd, tarball, directory, metadata } = await artifactFixture(t);
  await writeFile(join(cwd, 'package/package.json'), JSON.stringify({ name: 'other', version }));
  await runCommand('tar', ['-czf', tarball, '-C', cwd, 'package']);
  const bytes = await readFile(tarball);
  await writeFile(join(directory, metadata.filename), bytes);
  await writeFile(join(directory, 'metadata.json'), JSON.stringify({ ...metadata, integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}` }));
  await assert.rejects(verifyArtifact(directory, expected), /manifest name mismatch/);
});

test('registry lookup accepts only the exact version response or a parsed authoritative 404 error', async t => {
  let status = 200;
  let body = registryBody(integrity);
  const { base, paths } = await registryFixture(t, (_, response) => reply(response, status, body));
  assert.equal(await registryVersion(version, base), integrity);
  assert.equal(paths[0], '/%40kyn0v%2Fpi-tele/0.2.0');
  status = 404; body = { error: 'version not found: 0.2.0' };
  assert.equal(await registryVersion(version, base), undefined);
  for (const [code, value] of [
    [401, { error: 'unauthorized' }], [403, { error: 'forbidden' }], [500, { error: 'server' }],
    [404, {}], [404, '<html>not found</html>'], [200, 'not json'], [200, {}],
    [200, { ...registryBody(integrity), version: '0.1.0' }],
    [200, { ...registryBody(integrity), name: 'other' }],
    [200, { name, version, dist: {} }],
  ]) {
    status = code; body = value;
    await assert.rejects(registryVersion(version, base), `HTTP ${code} with ${JSON.stringify(value)} must fail closed`);
  }
});

test('the npm exact-version JSON string 404 is absence only for the requested version', async t => {
  let status = 404;
  let body = JSON.stringify(`version not found: ${version}`);
  const { base } = await registryFixture(t, (_, response) => reply(response, status, body));
  assert.equal(await registryVersion(version, base), undefined);
  for (const value of ['version not found: 9.9.9', 'Not found', '']) {
    body = JSON.stringify(value);
    await assert.rejects(registryVersion(version, base));
  }
  body = JSON.stringify(`version not found: ${version}`);
  for (const code of [401, 403, 500]) {
    status = code;
    await assert.rejects(registryVersion(version, base));
  }
});

test('registry transport failure is never absence', async t => {
  const { base } = await registryFixture(t, (request) => request.socket.destroy());
  await assert.rejects(registryVersion(version, base));
});

test('existing identical registry version no-ops, while mismatches and lookup failures never publish', async t => {
  const { directory, metadata } = await artifactFixture(t);
  let status = 200;
  let body = registryBody(metadata.integrity);
  const { base } = await registryFixture(t, (_, response) => reply(response, status, body));
  let publications = 0;
  const options = { base, publish: async () => { publications++; }, attempts: 2, retryDelay: 0 };
  assert.equal(await publishArtifact(directory, expected, options), 'already published with identical integrity');
  body = registryBody(integrity);
  await assert.rejects(publishArtifact(directory, expected, options), /different integrity/);
  for (const [code, value] of [[401, {}], [503, {}], [404, {}], [404, 'broken']]) {
    status = code; body = value;
    await assert.rejects(publishArtifact(directory, expected, options));
  }
  assert.equal(publications, 0);
});

test('only a genuine 404 permits one publish, followed by bounded registry readback', async t => {
  const { directory, metadata, tarball } = await artifactFixture(t);
  let published = false;
  let reads = 0;
  const { base } = await registryFixture(t, (_, response) => {
    reads++;
    if (!published || reads === 2) reply(response, 404, { error: 'version not found' });
    else reply(response, 200, registryBody(metadata.integrity));
  });
  let publications = 0;
  const result = await publishArtifact(directory, expected, {
    base, attempts: 3, retryDelay: 0,
    publish: async file => {
      publications++;
      assert.deepEqual(await readFile(file), await readFile(tarball));
      published = true;
      throw new Error('npm result uncertain after registry accepted bytes');
    },
  });
  assert.equal(result, 'published and registry integrity verified');
  assert.equal(publications, 1);
  assert.equal(reads, 3);
});

test('uncertain or conflicting publication fails without repeating npm publish', async t => {
  const { directory } = await artifactFixture(t);
  let lookups = 0;
  let conflict = false;
  const { base } = await registryFixture(t, (_, response) => {
    lookups++;
    if (conflict && lookups > 1) reply(response, 200, registryBody(integrity));
    else reply(response, 404, { error: 'version not found' });
  });
  let publications = 0;
  const options = { base, attempts: 2, retryDelay: 0, publish: async () => { publications++; throw new Error('uncertain'); } };
  await assert.rejects(publishArtifact(directory, expected, options), /Publication not confirmed/);
  assert.equal(publications, 1);
  assert.equal(lookups, 3);
  conflict = true; lookups = 0;
  await assert.rejects(publishArtifact(directory, expected, options), /different integrity/);
  assert.equal(publications, 2);
  assert.equal(lookups, 2, 'Conflicting integrity fails immediately');
});
