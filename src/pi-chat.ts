import { createHash, randomUUID } from 'node:crypto';
import type { ExtensionAPI, ExtensionContext, MessageStartEvent } from '@earendil-works/pi-coding-agent';
import { BindingSchema, type ChatAdapter, type ChatCommand, type ChatView, type Receipt } from './chat-schema.js';
import { boundItems, branchHistory, messageItems } from './chat-history.js';
import { HttpError } from './http.js';
import type { BoardId } from './schema.js';

type ChatContext = Pick<ExtensionContext, 'sessionManager' | 'isIdle' | 'hasPendingMessages' | 'abort'>;
type Activity = { kind: 'idle' | 'uncertain' | 'disconnected' } | { kind: 'submitted' | 'busy' | 'stopping'; runId: string };
export class PiChat implements ChatAdapter {
  private activity: Activity = { kind: 'idle' };
  private prompts = 0;
  private sequence = 0;
  private idleVersion = 0;
  private notice = '';
  private submission: ChatView['submission'] = null;
  private submittedTextHash = '';
  private submissionBranchLength = 0;
  private history: ReturnType<typeof branchHistory>;
  private live: ChatView['items'] = [];
  private liveId = '';
  private serial = 0;
  private listeners = new Set<(view: ChatView) => void>();
  private receipts = new Map<string, { hash: string; receipt: Receipt }>();
  private notification: ReturnType<typeof setTimeout> | undefined;
  private observation: ReturnType<typeof setTimeout> | undefined;
  readonly binding = BindingSchema.parse(randomUUID());
  readonly epoch = randomUUID();

  constructor(readonly boardId: BoardId, private ctx: ChatContext, private pi: Pick<ExtensionAPI, 'sendUserMessage'>, private observationMs = 8000) {
    this.history = branchHistory(ctx.sessionManager.getBranch());
  }
  snapshot(): ChatView {
    const bounded = boundItems([...this.history.items, ...this.live], this.history.truncated);
    return {
      binding: this.binding, epoch: this.epoch, boardId: this.boardId, sequence: this.sequence, idleVersion: this.idleVersion,
      sessionLabel: (this.ctx.sessionManager.getSessionName() ?? `Pi · ${this.ctx.sessionManager.getSessionId().slice(0, 8)}`).slice(0, 160),
      phase: this.activity.kind === 'disconnected' ? 'disconnected' : this.prompts > 0 ? 'terminal-required' : this.activity.kind,
      runId: 'runId' in this.activity ? this.activity.runId : null,
      notice: this.notice, submission: this.submission, ...bounded,
    };
  }
  subscribe(listener: (view: ChatView) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private changed() {
    this.sequence++;
    this.notification ??= setTimeout(() => {
      this.notification = undefined;
      const view = this.snapshot();
      for (const listener of this.listeners) listener(view);
    }, 40);
    this.notification.unref();
  }
  submit(command: ChatCommand): Receipt {
    if (command.epoch !== this.epoch || this.activity.kind === 'disconnected') throw new HttpError(409, 'Stale or detached connection');
    const hash = createHash('sha256').update(JSON.stringify(command)).digest('hex');
    const previous = this.receipts.get(command.id);
    if (previous) {
      if (previous.hash !== hash) throw new HttpError(409, 'Request ID was used for different content');
      return previous.receipt;
    }
    if (this.receipts.size >= 256) throw new HttpError(429, 'Connection command limit reached. Reattach in Pi.');
    let receipt: Receipt;
    if (command.kind === 'send') {
      if (command.idleVersion !== this.idleVersion) throw new HttpError(409, 'State changed. Review the latest conversation before sending.');
      if (this.activity.kind !== 'idle' || this.prompts || !this.ctx.isIdle() || this.ctx.hasPendingMessages()) throw new HttpError(409, 'Pi is busy or awaiting terminal action');
      if (/^\s*[\/!]/.test(command.text)) throw new HttpError(400, 'Browser input is music text, not slash or shell commands');
      this.activity = { kind: 'submitted', runId: randomUUID() };
      this.idleVersion++;
      this.submission = { id: command.id, state: 'submitted' };
      this.submittedTextHash = createHash('sha256').update(command.text).digest('hex');
      this.submissionBranchLength = this.ctx.sessionManager.getBranch().length;
      this.notice = '已提交给 Pi，尚未确认进入对话。不会自动重发。';
      receipt = { id: command.id, status: 'submitted' };
      this.receipts.set(command.id, { hash, receipt });
      this.changed();
      this.observation = setTimeout(() => {
        if (this.submission?.id !== command.id || this.submission.state !== 'submitted') return;
        this.submission = { id: command.id, state: 'unknown' };
        if (this.activity.kind === 'submitted') this.activity = { kind: 'uncertain' };
        this.notice = '未观察到输入。可能被其他扩展处理或提交失败；不会重发。请在终端检查，必要时 off 后重新连接。';
        this.changed();
      }, this.observationMs);
      this.observation.unref();
      try { this.pi.sendUserMessage(command.text, { expandPromptTemplates: false }); }
      catch {
        clearTimeout(this.observation);
        this.activity = { kind: 'uncertain' };
        this.submission = { id: command.id, state: 'unknown' };
        this.notice = '提交结果不确定。请检查 Pi 终端，不会自动重发。';
        this.changed();
      }
    } else {
      if (!('runId' in this.activity) || command.runId !== this.activity.runId || this.ctx.isIdle()) throw new HttpError(409, 'That run is no longer active');
      receipt = { id: command.id, status: 'stop-requested' };
      this.receipts.set(command.id, { hash, receipt });
      this.activity = { kind: 'stopping', runId: command.runId };
      this.notice = '已请求停止。等待 Pi 实际结束；终端对话框可能仍需操作。';
      this.changed();
      this.ctx.abort();
    }
    return receipt;
  }
  started(ctx: ChatContext) {
    if (this.activity.kind === 'disconnected') return;
    this.ctx = ctx;
    const runId = 'runId' in this.activity ? this.activity.runId : randomUUID();
    this.activity = { kind: 'busy', runId };
    this.idleVersion++;
    this.changed();
  }
  message(message: MessageStartEvent['message'], start: boolean) {
    if (this.activity.kind === 'disconnected') return;
    if (start) this.liveId = `live-${++this.serial}`;
    const userText = message.role === 'user' ? (typeof message.content === 'string' ? message.content : message.content.filter(block => block.type === 'text').map(block => block.text).join('\n')) : undefined;
    if (userText !== undefined && this.submission && ['submitted', 'unknown'].includes(this.submission.state) && createHash('sha256').update(userText).digest('hex') === this.submittedTextHash) {
      this.submission = { ...this.submission, state: 'observed' };
      clearTimeout(this.observation);
      this.notice = '已观察到本次输入进入 Pi 对话。';
    }
    this.live = boundItems([...this.live.filter(item => item.id !== this.liveId && !item.id.startsWith(`${this.liveId}:`)), ...messageItems(message, this.liveId)]).items;
    this.changed();
  }
  sync(ctx: ChatContext, settled = false) {
    if (this.activity.kind === 'disconnected') return;
    this.ctx = ctx;
    this.history = branchHistory(ctx.sessionManager.getBranch());
    this.live = [];
    if (settled) {
      clearTimeout(this.observation);
      this.activity = { kind: 'idle' };
      this.idleVersion++;
      if (this.submission) {
        const observed = ctx.sessionManager.getBranch().slice(this.submissionBranchLength).some(entry => {
          if (entry.type !== 'message' || entry.message.role !== 'user') return false;
          const content = entry.message.content;
          const text = typeof content === 'string' ? content : content.filter(block => block.type === 'text').map(block => block.text).join('\n');
          return createHash('sha256').update(text).digest('hex') === this.submittedTextHash;
        });
        this.submission = { ...this.submission, state: observed ? 'settled' : 'unknown' };
      }
      this.notice = this.submission?.state === 'unknown' ? 'Pi 已结束，但未确认浏览器输入进入对话。请检查历史，不会重发。' : 'Pi 本次运行已结束。';
    }
    this.changed();
  }
  prompt(open: boolean) { this.prompts = Math.max(0, this.prompts + (open ? 1 : -1)); this.changed(); }
  close() {
    this.activity = { kind: 'disconnected' };
    clearTimeout(this.notification); clearTimeout(this.observation);
    this.sequence++;
    for (const listener of this.listeners) listener(this.snapshot());
    this.listeners.clear(); this.live = []; this.history = { items: [], truncated: false }; this.receipts.clear();
  }
}
