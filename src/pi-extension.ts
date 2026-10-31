import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { z } from 'zod';
import { configuration } from './config.js';
import { catalogueEntries } from './music.js';
import { PiChat } from './pi-chat.js';
import { BoardIdSchema, ContentSchema, RevisionSchema, demoContent, type Content } from './schema.js';
import { startServer } from './server.js';

export const BOARD_TOOL = 'audioharness_board';
const parameters = Type.Object({
  action: Type.Union([Type.Literal('catalogue'), Type.Literal('get'), Type.Literal('put')]),
  expectedRevision: Type.Optional(Type.Integer({ minimum: 0 })),
  content: Type.Optional(Type.Unsafe<Content>(z.toJSONSchema(ContentSchema))),
}, { additionalProperties: false });
const PutSchema = z.strictObject({ action: z.literal('put'), expectedRevision: RevisionSchema, content: ContentSchema });
const ReadSchema = z.strictObject({
  action: z.enum(['catalogue', 'get']),
  expectedRevision: z.unknown().optional(),
  content: z.unknown().optional(),
}).transform(({ action }) => ({ action }));
export const BoardCommandSchema = z.union([PutSchema, ReadSchema]);

export default function audioharness(pi: ExtensionAPI) {
  let owned: { chat: PiChat; service: Awaited<ReturnType<typeof startServer>>; tools: string[] } | undefined;
  let changing = false;
  let generation = 0;
  let detaching = false;
  pi.registerFlag('audioharness-port', { description: 'AudioHarness loopback port (0 selects a free port)', type: 'string' });
  pi.registerFlag('audioharness-data', { description: 'AudioHarness board data directory', type: 'string' });

  async function detach(ctx: ExtensionContext, wait?: () => Promise<void>) {
    generation++;
    const current = owned;
    if (!current) return;
    detaching = true;
    current.chat.close();
    await current.service.stop();
    if (wait) await wait();
    if (owned !== current) return;
    pi.setActiveTools(current.tools);
    owned = undefined; detaching = false;
    ctx.ui.setStatus('audioharness', undefined);
  }
  pi.registerTool({
    name: BOARD_TOOL, label: 'AudioHarness board',
    description: 'Read the chord catalogue or get/replace the attached music board. No other board is accessible. For put, first get its revision and pass expectedRevision plus the complete content. Never edit application files.',
    exposure: 'model-only',
    annotations: { destructiveHint: false, openWorldHint: false, idempotentHint: false },
    parameters,
    async execute(_id, input) {
      if (!owned || detaching) throw new Error('AudioHarness is not attached');
      const command = BoardCommandSchema.parse(input);
      const { service, chat } = owned;
      const result = command.action === 'put' ? service.putBoard(chat.boardId, command.expectedRevision, command.content)
        : command.action === 'get' ? service.getBoard(chat.boardId)
        : { tuning: 'standard', chords: catalogueEntries() };
      return { content: [{ type: 'text', text: JSON.stringify(result) }], details: undefined };
    },
  });
  pi.on('session_start', () => { pi.setActiveTools(pi.getActiveTools().filter(name => name !== BOARD_TOOL)); });
  pi.on('tool_call', event => {
    if ((owned && (detaching || event.toolName !== BOARD_TOOL)) || (!owned && event.toolName === BOARD_TOOL)) return { block: true, reason: 'AudioHarness music mode allows only its attached board tool. Use /audioharness off in Pi to restore the previous tools.' };
  });
  pi.on('before_agent_start', event => {
    if (!owned || detaching) return;
    pi.setActiveTools([BOARD_TOOL]);
    event.systemPromptOptions.selectedTools = [BOARD_TOOL];
    event.systemPromptOptions.promptGuidelines.push('AudioHarness music mode is active. Discuss music and use audioharness_board to update the attached listening board. Do not rewrite application source. Board edits are public on this local service; do not copy private conversation into the board without user intent.');
  });
  pi.on('agent_start', (_event, ctx) => owned?.chat.started(ctx));
  pi.on('message_start', event => owned?.chat.message(event.message, true));
  pi.on('message_update', event => owned?.chat.message(event.message, false));
  pi.on('message_end', event => owned?.chat.message(event.message, false));
  pi.on('turn_end', (_event, ctx) => { owned?.chat.sync(ctx); });
  pi.on('agent_settled', (_event, ctx) => owned?.chat.sync(ctx, true));
  pi.on('session_compact', (_event, ctx) => owned?.chat.sync(ctx));
  pi.on('session_info_changed', (_event, ctx) => owned?.chat.sync(ctx));
  pi.on('ui_prompt_start', () => owned?.chat.prompt(true));
  pi.on('ui_prompt_end', () => owned?.chat.prompt(false));
  pi.on('session_tree', async (_event, ctx) => { await detach(ctx); });
  pi.on('session_shutdown', async (_event, ctx) => { await detach(ctx); });

  pi.registerCommand('audioharness', {
    description: 'Attach this live Pi to a music board, or off to detach and restore tools',
    handler: async (args, ctx) => {
      if (changing) { ctx.ui.notify('AudioHarness 正在切换，请稍后重试。', 'warning'); return; }
      changing = true;
      try {
        if (args.trim() === 'off') {
          await detach(ctx, () => ctx.waitForIdle());
          ctx.ui.notify('AudioHarness 已断开。Pi 仍在运行，原工具已恢复。', 'info'); return;
        }
        const parsed = BoardIdSchema.safeParse(args.trim());
        if (!parsed.success) { ctx.ui.notify('用法：/audioharness <boardid> 或 /audioharness off', 'warning'); return; }
        if (!ctx.isIdle() || ctx.hasPendingMessages()) { ctx.ui.notify('请等待 Pi 空闲且待处理消息清空后连接。', 'warning'); return; }
        if (owned) { ctx.ui.notify('已经连接。请先 /audioharness off，再显式连接以重新配对。', 'warning'); return; }
        const currentGeneration = ++generation;
        const config = configuration();
        const port = z.coerce.number().int().min(0).max(65535).parse(pi.getFlag('audioharness-port') ?? config.port);
        const dataFlag = pi.getFlag('audioharness-data');
        const dataDir = typeof dataFlag === 'string' ? resolve(dataFlag) : config.dataDir;
        const chat = new PiChat(parsed.data, ctx, pi);
        const service = await startServer({ dataDir, port, chat });
        if (currentGeneration !== generation || !ctx.isIdle() || ctx.hasPendingMessages()) {
          chat.close(); await service.stop();
          ctx.ui.notify('Pi 状态已变化，本次没有连接。请在空闲时重试。', 'warning'); return;
        }
        const tools = pi.getActiveTools().filter(name => name !== BOARD_TOOL);
        owned = { chat, service, tools };
        if (!service.getBoard(parsed.data)) service.putBoard(parsed.data, RevisionSchema.parse(0), demoContent);
        pi.setActiveTools([BOARD_TOOL]);
        if (!pi.getActiveTools().includes(BOARD_TOOL)) throw new Error('Tool allowlist excludes audioharness_board');
        ctx.ui.setStatus('audioharness', `音乐模式 · ${parsed.data} · /audioharness off 恢复工具`);
        const invitation = service.inviteChat();
        if (!invitation) throw new Error('Missing invitation');
        ctx.ui.notify(`AudioHarness 已连接当前 Pi。临时只允许白板工具。终端确认框仍需终端操作。两分钟内打开以下一次性私有链接（不要分享）：\n${invitation}`, 'info');
        if (ctx.mode === 'tui') {
          const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'rundll32' : 'xdg-open';
          const open = spawn(command, process.platform === 'win32' ? ['url.dll,FileProtocolHandler', invitation] : [invitation], { stdio: 'ignore', detached: true });
          open.on('error', () => ctx.ui.notify('无法自动打开浏览器，请使用上面的私有链接。', 'warning'));
          open.unref();
        }
      } catch {
        await detach(ctx);
        ctx.ui.notify('AudioHarness 启动失败。请检查数据目录、构建产物和端口，并确认 --tools 包含 audioharness_board。若独立服务占用它们，请由其所有者先停止服务，再连接；不会自动终止其他进程。', 'error');
      } finally { changing = false; }
    },
  });
}
