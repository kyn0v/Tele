import { randomBytes, randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BoardIdSchema, BoardSchema, MAX_BODY_BYTES, MAX_BOARDS, RevisionSchema, type Board, type BoardId, type Content, type Revision } from './schema.js';

export class StoreError extends Error {
  constructor(readonly status: number, message: string, readonly currentRevision?: number) { super(message); }
}

function atomicWrite(path: string, text: string) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const fd = openSync(temporary, 'wx', 0o600);
    try { writeFileSync(fd, text); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(temporary, path);
  } catch (error) { rmSync(temporary, { force: true }); throw error; }
}

export function openStore(dataDir: string) {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const directory = realpathSync(dataDir);
  const lock = join(directory, 'server.lock');
  try { mkdirSync(lock, { mode: 0o700 }); } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
      throw new Error(`Data directory is locked: ${lock}. Stop its server. After a crash, confirm the owner is gone before manually removing this lock directory.`);
    }
    throw error;
  }
  let closed = false;
  const close = () => { if (!closed) { closed = true; rmSync(lock, { recursive: true, force: true }); } };
  try {
    writeFileSync(join(lock, 'owner.json'), JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }), { mode: 0o600 });
    const tokenPath = join(directory, 'capability');
    if (!existsSync(tokenPath)) atomicWrite(tokenPath, randomBytes(32).toString('hex'));
    const token = readFileSync(tokenPath, 'utf8').trim();
    if (!/^[a-f0-9]{64}$/.test(token)) throw new Error(`Invalid local capability file: ${tokenPath}`);
    const boardsDir = join(directory, 'boards');
    mkdirSync(boardsDir, { recursive: true, mode: 0o700 });
    const files = readdirSync(boardsDir).filter(file => file.endsWith('.json'));
    if (files.length > MAX_BOARDS) throw new Error(`Data directory exceeds ${MAX_BOARDS} boards`);
    const boards = new Map<BoardId, Board>();
    for (const file of files) {
      const path = join(boardsDir, file);
      if (statSync(path).size > MAX_BODY_BYTES + 1024) throw new Error(`Oversized stored board: ${file}`);
      const board = BoardSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
      if (file !== `${board.id}.json`) throw new Error(`Stored board ID does not match filename: ${file}`);
      boards.set(board.id, board);
    }
    return {
      token,
      close,
      get(id: BoardId) { return boards.get(id); },
      put(id: BoardId, expected: Revision, content: Content): Board {
        if (closed) throw new Error('Store is closed');
        id = BoardIdSchema.parse(id);
        expected = RevisionSchema.parse(expected);
        const previous = boards.get(id);
        const actual = previous?.revision ?? 0;
        if (expected !== actual) throw new StoreError(409, 'Revision conflict. Get the current board before retrying.', actual);
        if (!previous && boards.size >= MAX_BOARDS) throw new StoreError(507, 'Board limit reached');
        if (actual >= Number.MAX_SAFE_INTEGER - 1) throw new StoreError(507, 'Revision limit reached');
        const board = BoardSchema.parse({ id, revision: actual + 1, content });
        const serialized = JSON.stringify(board);
        if (Buffer.byteLength(serialized, 'utf8') > MAX_BODY_BYTES + 1024) {
          throw new StoreError(413, 'Serialized board exceeds the storage size limit');
        }
        atomicWrite(join(boardsDir, `${id}.json`), serialized);
        boards.set(id, board);
        return board;
      },
    };
  } catch (error) { close(); throw error; }
}

export type BoardStore = ReturnType<typeof openStore>;
export const demoId = BoardIdSchema.parse('demo');
