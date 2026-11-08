import { access, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { z } from 'zod';
import { defaultPublicDir } from './config.js';
import { catalogueEntries, ChordSymbolSchema } from './music.js';
import { BoardIdSchema, ContentSchema, MAX_BODY_BYTES, RevisionSchema } from './schema.js';
import { startServer } from './server.js';

export const inject = ['tools'];
export const Config = z.strictObject({
  dataDir: z.string().min(1).refine(isAbsolute, 'Use an absolute data directory').default(join(homedir(), '.tele', 'dsh')),
  port: z.number().int().min(0).max(65535).default(0),
});
export const BOARD_TOOL = 'tele_board';
export const PUBLIC_FILES = ['index.html', 'favicon.svg', 'assets/web.js', 'assets/audio.js', 'assets/style.css'] as const;

const CommandSchema = z.discriminatedUnion('action', [
  // Some providers materialize optional fields. Ignore irrelevant read fields;
  // never interpret them as a write or relax the put contract.
  z.strictObject({ action: z.literal('catalogue'), boardId: z.unknown().optional(), expectedRevision: z.unknown().optional(), content: z.unknown().optional() }).transform(() => ({ action: 'catalogue' as const })),
  z.strictObject({ action: z.literal('get'), boardId: BoardIdSchema, expectedRevision: z.unknown().optional(), content: z.unknown().optional() }).transform(({ boardId }) => ({ action: 'get' as const, boardId })),
  z.strictObject({ action: z.literal('put'), boardId: BoardIdSchema, expectedRevision: RevisionSchema, content: ContentSchema }),
]);

// DSH 0.2.2's wire schema subset does not include regex/range/size constraints.
// Advertise its supported vocabulary; enforce the complete Zod contract in execute.
const parameters = {
  type: 'object', additionalProperties: false,
  properties: {
    action: { type: 'string', enum: ['catalogue', 'get', 'put'] },
    boardId: { type: 'string', description: 'Required for get/put: 1–48 lowercase letters, digits or hyphens; start with a letter or digit.' },
    expectedRevision: { type: 'integer', description: 'Required for put: current revision from get, or 0 to create. Never blindly retry a conflict.' },
    content: {
      type: 'object', additionalProperties: false, required: ['title', 'groups'],
      properties: {
        title: { type: 'string', description: 'Nonempty title, at most 120 characters.' },
        description: { type: 'string', description: 'Optional description, at most 1200 characters.' },
        tempo: { type: 'integer', description: '40–200 BPM; defaults to 90.' },
        groups: {
          type: 'array', description: '1–12 ordered groups with unique IDs.',
          items: {
            type: 'object', additionalProperties: false, required: ['id', 'title', 'chords'],
            properties: {
              id: { type: 'string' }, title: { type: 'string' }, description: { type: 'string' },
              chords: { type: 'array', description: '1–32 supported chord symbols; use catalogue first.', items: { type: 'string', enum: ChordSymbolSchema.options } },
            },
          },
        },
      },
    },
  },
  required: ['action'],
} as const;

// Deliberately structural: no bundled copy of Cordis or the DSH tool registry.
// This is DSH's raw ToolDefinition contract, not Pi's registerTool contract.
export interface DshTool {
  name: string;
  description: string;
  parameters: typeof parameters;
  output: { schema: { type: 'object'; additionalProperties: true }; render(args: unknown, value: unknown): { type: 'text'; text: string }[] };
  isConcurrencySafe(args: unknown): boolean;
  execute(args: unknown, exec: { signal: AbortSignal }): Promise<unknown>;
}
export interface DshContext {
  effect(setup: () => Promise<() => Promise<void>>, label?: string): PromiseLike<() => Promise<void>>;
  tools: { register(definition: DshTool): () => void | Promise<void> };
}

// Source-level factory allows isolated pre-build tests to supply owned assets.
// The Loader always uses apply below; publicDir is not a user configuration field.
export function createDshPlugin(publicDir: string) {
  return async function apply(ctx: DshContext, config: unknown) {
    const options = Config.parse(config);
    // Fail activation before creating a data lock if the distributed UI is missing.
    await Promise.all(PUBLIC_FILES.map(async file => {
      const path = join(publicDir, file);
      await access(path, constants.R_OK);
      if (!(await stat(path)).isFile()) throw new Error(`Browser asset is not a regular file: ${file}`);
    }));
    await ctx.effect(async () => {
      const service = await startServer({ ...options, publicDir, seedDemo: false, boardOnly: true });
      let stopping = false;
      let unregister: (() => void | Promise<void>) | undefined;
      const dispose = async () => {
        stopping = true;
        try { await unregister?.(); } finally { await service.stop(); }
      };
      try {
        unregister = ctx.tools.register({
          name: BOARD_TOOL,
          description: 'Read the Tele guitar chord catalogue or get/create/replace a listening board. Boards are public to local readers and shared across this DSH profile, not private conversation storage. For put, read the latest revision and replace the complete content, preserving other groups. Open the returned URL in a browser on the DSH host to listen. This tool does not connect chat, restrict other tools, or open a browser automatically.',
          parameters,
          output: {
            schema: { type: 'object', additionalProperties: true },
            render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
          },
          isConcurrencySafe: args => {
            const command = CommandSchema.safeParse(args);
            return command.success && command.data.action !== 'put';
          },
          async execute(input, exec) {
            exec.signal.throwIfAborted();
            if (stopping) throw new Error('Tele is stopping');
            const command = CommandSchema.parse(input);
            if (command.action === 'catalogue') return { tuning: 'standard', chords: catalogueEntries() };
            if (command.action === 'put' && Buffer.byteLength(JSON.stringify(command.content), 'utf8') > MAX_BODY_BYTES) {
              throw new Error(`Board content exceeds ${MAX_BODY_BYTES} UTF-8 JSON bytes`);
            }
            // No async gap between the last cancellation check and the synchronous commit.
            exec.signal.throwIfAborted();
            if (stopping) throw new Error('Tele is stopping');
            const board = command.action === 'put'
              ? service.putBoard(command.boardId, command.expectedRevision, command.content)
              : service.getBoard(command.boardId);
            if (!board) return { boardId: command.boardId, exists: false, revision: 0 };
            return structuredClone({ ...board, url: `${service.url}/b/${board.id}` });
          },
        });
      } catch (error) {
        await dispose();
        throw error;
      }
      return dispose;
    }, 'Tele board service and tool');
  };
}

export const apply = createDshPlugin(defaultPublicDir);
