import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const commands = new Set();

function groupExists(pid) {
  try { process.kill(-pid, 0); return true; }
  catch (error) {
    if (error.code === 'ESRCH') return false;
    if (error.code === 'EPERM') return true;
    throw error;
  }
}
function signalGroup(pid, signal) {
  try { process.kill(-pid, signal); }
  catch (error) { if (error.code !== 'ESRCH') throw error; }
}
async function waitFor(predicate, timeout) {
  const end = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() >= end) return false;
    await delay(20);
  }
  return true;
}

export async function closeOwnedCommands() {
  const results = await Promise.allSettled([...commands].map(close => close()));
  const failures = results.filter(result => result.status === 'rejected');
  if (failures.length) throw new AggregateError(failures.map(result => result.reason), 'Owned commands did not close');
}

export async function runCommand(file, args, options = {}) {
  if (process.platform === 'win32') {
    throw Object.assign(new Error('Package verification requires POSIX process groups'), { code: 'ENOTSUP' });
  }
  const { timeout = 30_000, maxBuffer = 4 * 1024 * 1024, ...spawnOptions } = options;
  const child = spawn(file, args, { ...spawnOptions, shell: false, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let closed = false;
  child.once('close', () => { closed = true; });
  const close = async () => {
    const gone = () => closed && (!child.pid || !groupExists(child.pid));
    if (child.pid && groupExists(child.pid)) {
      signalGroup(child.pid, 'SIGTERM');
      if (!await waitFor(gone, 500)) signalGroup(child.pid, 'SIGKILL');
    }
    if (!await waitFor(gone, 3000)) {
      throw Object.assign(new Error('Owned command group did not close'), { code: 'ECLEANUP' });
    }
    commands.delete(close);
  };
  commands.add(close);

  let failure;
  let fail;
  const failed = new Promise(resolve => {
    fail = error => {
      failure ??= error;
      resolve();
    };
  });
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  child.once('error', fail);
  const signalHandlers = ['SIGINT', 'SIGTERM'].map(signal => {
    const listener = () => fail(Object.assign(new Error('Command interrupted'), { code: signal, signal }));
    process.on(signal, listener);
    return [signal, listener];
  });
  const output = { stdout: [], stderr: [] };
  for (const name of ['stdout', 'stderr']) {
    let bytes = 0;
    child[name].on('error', fail);
    child[name].on('data', chunk => {
      const remaining = Math.max(0, maxBuffer - bytes);
      if (remaining > 0) output[name].push(chunk.subarray(0, remaining));
      bytes += chunk.length;
      if (bytes > maxBuffer) fail(Object.assign(new Error(`${name} exceeded maxBuffer`), { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' }));
    });
  }
  const timer = setTimeout(() => fail(Object.assign(new Error('Command deadline exceeded'), { code: 'ETIMEDOUT' })), timeout);
  let status;
  try {
    status = await Promise.race([exited, failed]);
    clearTimeout(timer);
    await close();
  } catch (error) {
    failure = error;
  } finally {
    clearTimeout(timer);
    for (const [signal, listener] of signalHandlers) process.off(signal, listener);
  }
  const captured = Object.fromEntries(Object.entries(output).map(([name, chunks]) => [name, Buffer.concat(chunks).toString('utf8')]));
  if (!failure && status?.code !== 0) {
    failure = Object.assign(new Error('Command failed'), { code: status?.code, signal: status?.signal });
  }
  if (failure) throw Object.assign(failure, captured);
  return captured;
}
