import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFile, copyFile, lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { runCommand } from './package-command.mjs';

const name = '@kyn0v/pi-tele';
const registry = 'https://registry.npmjs.org';
const stable = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const commitPattern = /^[a-f0-9]{40}$/;
const integrityPattern = /^sha512-[A-Za-z0-9+/]{86}==$/;
const digest = bytes => `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
const json = async file => JSON.parse(await readFile(file, 'utf8'));

export function artifactDirectory(args) {
  if (!args.length) return undefined;
  assert(args.length === 2 && args[0] === '--artifact-dir' && isAbsolute(args[1]),
    'Usage: --artifact-dir <absolute new directory>');
  return resolve(args[1]);
}

export function releaseIdentity(event, eventName, repository) {
  assert.equal(eventName, 'release', 'Only release events may publish');
  assert.equal(repository, 'kyn0v/Tele', 'Unexpected repository');
  assert.equal(event.repository?.full_name, repository, 'Event repository mismatch');
  assert.equal(event.action, 'published', 'Release must be published');
  assert.equal(event.release?.draft, false, 'Draft releases cannot publish');
  assert.equal(event.release?.prerelease, false, 'Prereleases cannot publish');
  const tag = event.release.tag_name;
  assert(typeof tag === 'string' && tag.startsWith('v') && stable.test(tag.slice(1)), 'Expected canonical vX.Y.Z tag');
  return { version: tag.slice(1), tag };
}

export function validateVersions(manifest, lock, version) {
  assert.equal(manifest.name, name, 'Unexpected package name');
  assert(stable.test(version), 'Expected stable version');
  assert.equal(manifest.version, version, 'Package version must match release');
  assert.equal(lock.name, name, 'Lockfile name mismatch');
  assert.equal(lock.version, version, 'Lockfile version mismatch');
  assert.equal(lock.packages?.['']?.name, name, 'Lockfile root name mismatch');
  assert.equal(lock.packages?.['']?.version, version, 'Lockfile root version mismatch');
}

export async function preflight(event, eventName, repository, cwd) {
  const identity = releaseIdentity(event, eventName, repository);
  const git = async args => (await runCommand('git', args, { cwd, timeout: 15_000 })).stdout.trim();
  const commit = await git(['rev-parse', '--verify', `refs/tags/${identity.tag}^{commit}`]);
  assert(commitPattern.test(commit), 'Tag must resolve to an immutable commit');
  await git(['merge-base', '--is-ancestor', commit, 'refs/remotes/origin/main']);
  const manifest = JSON.parse(await git(['show', `${commit}:package.json`]));
  const lock = JSON.parse(await git(['show', `${commit}:package-lock.json`]));
  validateVersions(manifest, lock, identity.version);
  return { ...identity, commit };
}

function validateMetadata(metadata, expected) {
  assert.deepEqual(Object.keys(metadata).sort(), ['commit', 'filename', 'integrity', 'name', 'version']);
  assert.equal(metadata.name, name, 'Unexpected artifact package');
  assert(typeof metadata.version === 'string' && stable.test(metadata.version), 'Invalid artifact version');
  assert(typeof metadata.commit === 'string' && commitPattern.test(metadata.commit), 'Invalid artifact commit');
  assert(typeof metadata.integrity === 'string' && integrityPattern.test(metadata.integrity), 'Invalid artifact integrity');
  assert.equal(metadata.filename, `kyn0v-pi-tele-${metadata.version}.tgz`, 'Invalid artifact basename');
  assert.equal(basename(metadata.filename), metadata.filename);
  if (expected) {
    assert.equal(metadata.version, expected.version, 'Artifact release version mismatch');
    assert.equal(metadata.commit, expected.commit, 'Artifact commit mismatch');
  }
}

export async function exportArtifact(tarball, directory, commit) {
  const bytes = await readFile(tarball);
  const manifest = JSON.parse((await runCommand('tar', ['-xOf', tarball, 'package/package.json'], { timeout: 15_000 })).stdout);
  const metadata = { filename: basename(tarball), name: manifest.name, version: manifest.version, commit, integrity: digest(bytes) };
  validateMetadata(metadata);
  await mkdir(directory);
  try {
    await copyFile(tarball, join(directory, metadata.filename));
    await writeFile(join(directory, 'metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`, { flag: 'wx' });
    return await verifyArtifact(directory, metadata);
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

export async function verifyArtifact(directory, expected) {
  assert(!(await lstat(directory)).isSymbolicLink(), 'Artifact directory must not be a symlink');
  const metadataPath = join(directory, 'metadata.json');
  assert((await lstat(metadataPath)).isFile(), 'Metadata must be a regular file');
  const metadata = await json(metadataPath);
  validateMetadata(metadata, expected);
  assert.deepEqual((await readdir(directory)).sort(), [metadata.filename, 'metadata.json'].sort(), 'Artifact contains only tarball and metadata');
  const tarball = join(directory, metadata.filename);
  assert((await lstat(tarball)).isFile(), 'Tarball must be a regular file');
  assert.equal(digest(await readFile(tarball)), metadata.integrity, 'Tarball integrity mismatch');
  const manifest = JSON.parse((await runCommand('tar', ['-xOf', tarball, 'package/package.json'], { timeout: 15_000 })).stdout);
  assert.equal(manifest.name, metadata.name, 'Tar manifest name mismatch');
  assert.equal(manifest.version, metadata.version, 'Tar manifest version mismatch');
  return metadata;
}

export async function registryVersion(version, base = registry) {
  assert(stable.test(version), 'Invalid registry version');
  const response = await fetch(`${base}/${encodeURIComponent(name)}/${version}`, {
    signal: AbortSignal.timeout(15_000), redirect: 'error', headers: { accept: 'application/json' },
  });
  const body = await response.json();
  if (response.status === 404 && (body === `version not found: ${version}` || typeof body?.error === 'string' && body.error.length > 0)) return undefined;
  assert.equal(response.status, 200, `Registry lookup failed with HTTP ${response.status}`);
  assert.equal(body.name, name, 'Registry package mismatch');
  assert.equal(body.version, version, 'Registry version mismatch');
  assert(typeof body.dist?.integrity === 'string' && integrityPattern.test(body.dist.integrity), 'Registry integrity missing or invalid');
  return body.dist.integrity;
}

export async function publishArtifact(directory, expected, {
  base = registry,
  publish = tarball => runCommand('npm', ['publish', tarball, '--access', 'public', '--ignore-scripts', `--registry=${registry}`], { timeout: 120_000 }),
  attempts = 5,
  retryDelay = 2000,
} = {}) {
  const metadata = await verifyArtifact(directory, expected);
  const existing = await registryVersion(metadata.version, base);
  if (existing !== undefined) {
    assert.equal(existing, metadata.integrity, 'Published version has different integrity');
    return 'already published with identical integrity';
  }
  let publishError;
  try { await publish(join(directory, metadata.filename)); }
  catch (error) { publishError = error; }
  let lookupError;
  for (let attempt = 0; attempt < attempts; attempt++) {
    let integrity;
    try { integrity = await registryVersion(metadata.version, base); }
    catch (error) { lookupError = error; }
    if (integrity !== undefined) {
      assert.equal(integrity, metadata.integrity, 'Published version has different integrity');
      return 'published and registry integrity verified';
    }
    if (attempt + 1 < attempts) await delay(retryDelay);
  }
  throw new AggregateError([publishError, lookupError].filter(Boolean), 'Publication not confirmed. Inspect registry before retrying; npm publish was attempted only once.');
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  assert.equal(args.length, command === 'publish' ? 3 : 0, 'Invalid release arguments');
  if (command === 'preflight') {
    const result = await preflight(await json(process.env.GITHUB_EVENT_PATH), process.env.GITHUB_EVENT_NAME, process.env.GITHUB_REPOSITORY, process.cwd());
    await appendFile(process.env.GITHUB_OUTPUT, `commit=${result.commit}\nversion=${result.version}\n`);
    console.log(JSON.stringify(result));
  } else {
    assert.equal(command, 'publish', 'Expected preflight or publish');
    const [directory, version, commit] = args;
    console.log(await publishArtifact(directory, { version, commit }));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
