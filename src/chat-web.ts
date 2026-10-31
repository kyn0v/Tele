import { BindingSchema, ChatViewSchema, PairSchema, ReceiptSchema, type ChatView, type Binding } from './chat-schema.js';
import type { BoardId } from './schema.js';

let invitation = location.hash.startsWith('#chat=') ? location.hash.slice(6) : '';
if (invitation) history.replaceState(null, '', location.pathname + location.search);
function node<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = '') {
  const element = document.createElement(tag); element.className = className; element.textContent = text; return element;
}
function stored(key: string) { try { return localStorage.getItem(key); } catch { return null; } }
function save(key: string, value: string) { try { localStorage.setItem(key, value); } catch { } }

export function mountChat(boardId: BoardId) {
  const panel = node('aside', 'chat-panel'); panel.setAttribute('aria-label', 'Pi 对话');
  const header = node('div', 'chat-header');
  const heading = node('h2', 'chat-title', '一起聊音乐');
  const collapse = node('button', 'chat-collapse', '收起'); collapse.type = 'button';
  collapse.setAttribute('aria-controls', 'chat-body');
  header.append(heading, collapse);
  const body = node('div', 'chat-body'); body.id = 'chat-body';
  const label = node('p', 'chat-session', '未连接 Pi');
  const controls = node('div', 'chat-controls');
  const dockLabel = node('label', '', '位置 ');
  const dock = node('select', 'chat-dock'); dock.setAttribute('aria-label', '对话面板位置');
  for (const [value, text] of [['right', '右侧'], ['left', '左侧'], ['bottom', '底部']]) {
    const option = node('option', '', text); option.value = value ?? ''; dock.append(option);
  }
  const preference = stored('audioharness.chat.dock');
  dock.value = preference === 'left' || preference === 'bottom' ? preference : 'right';
  dockLabel.append(dock); controls.append(dockLabel);
  const status = node('p', 'chat-status'); status.setAttribute('role', 'status');
  const limitation = node('p', 'chat-limitation', '连接后仅开放当前白板工具。Pi 的确认框仍需在终端处理。');
  const historyNode = node('div', 'chat-history'); historyNode.tabIndex = 0; historyNode.setAttribute('aria-label', '当前分支对话历史');
  const truncated = node('p', 'chat-truncated', '仅显示最近的部分历史，长消息可能截断。完整记录仍在 Pi。'); truncated.hidden = true;
  const form = node('form', 'chat-composer');
  const inputLabel = node('label', '', '继续对话'); inputLabel.htmlFor = 'chat-input';
  const input = node('textarea', 'chat-input'); input.id = 'chat-input'; input.rows = 3; input.maxLength = 8000; input.placeholder = '想听哪种变化？Shift+Enter 换行';
  const actions = node('div', 'chat-actions');
  const send = node('button', 'chat-send', '发送'); send.type = 'submit'; send.disabled = true;
  const abort = node('button', 'chat-abort', '停止回复'); abort.type = 'button'; abort.disabled = true;
  const retry = node('button', 'chat-reconnect', '重新读取状态'); retry.type = 'button';
  actions.append(send, abort); form.append(inputLabel, input, actions);
  const feedback = node('p', 'chat-feedback'); feedback.setAttribute('role', 'status');
  body.append(label, controls, status, limitation, truncated, historyNode, form, feedback, retry);
  panel.append(header, body); document.body.append(panel);
  let collapsed = stored('audioharness.chat.collapsed') === 'true';
  function layout() {
    document.body.dataset.chatDock = dock.value;
    document.body.dataset.chatCollapsed = String(collapsed);
    body.hidden = collapsed;
    collapse.textContent = collapsed ? '展开对话' : '收起';
    collapse.setAttribute('aria-expanded', String(!collapsed));
  }
  dock.addEventListener('change', () => { save('audioharness.chat.dock', dock.value); layout(); });
  collapse.addEventListener('click', () => { collapsed = !collapsed; save('audioharness.chat.collapsed', String(collapsed)); layout(); });
  layout();
  let binding: Binding | undefined;
  let view: ChatView | undefined;
  let events: EventSource | undefined;
  let connected = false;
  let pending: { id: string; text: string } | undefined;
  let awaitingReceipt = false;
  let connectionGeneration = 0;
  const bindingKey = `audioharness.chat.binding:${boardId}`;
  const titles = { idle: '可以继续对话', submitted: '已提交，等待 Pi 确认', busy: 'Pi 正在回复', stopping: '正在等待停止', 'terminal-required': '需要终端操作，浏览器不能代为确认', uncertain: '提交结果不确定，请检查终端', disconnected: 'Pi 已断开' };
  function buttons() {
    send.disabled = !connected || view?.phase !== 'idle' || Boolean(pending) || awaitingReceipt || !input.value.trim();
    abort.disabled = !connected || !view?.runId || view.phase === 'stopping' || view.phase === 'idle';
  }
  function apply(next: ChatView) {
    if (next.boardId !== boardId || next.binding !== binding) throw new Error('Wrong connection');
    if (view && (next.epoch !== view.epoch || next.sequence < view.sequence)) return;
    const pinned = historyNode.scrollHeight - historyNode.scrollTop - historyNode.clientHeight < 48;
    const scroll = historyNode.scrollTop;
    const existing = new Map(Array.from(historyNode.children).filter(child => child instanceof HTMLElement).map(child => [child.dataset.id, child]));
    const keep = new Set(next.items.map(item => item.id));
    for (const [id, child] of existing) if (!id || !keep.has(id)) child.remove();
    for (const item of next.items) {
      let entry = existing.get(item.id);
      if (!entry) {
        entry = node('article', `chat-message chat-${item.role}`); entry.dataset.id = item.id;
        entry.append(node('span', 'chat-role', { user: '你', assistant: 'Pi', tool: '工具', notice: '提示' }[item.role]), node('p', 'chat-text'));
      }
      const text = entry.querySelector('.chat-text'); if (text && text.textContent !== item.text) text.textContent = item.text;
      historyNode.append(entry);
    }
    historyNode.scrollTop = pinned ? historyNode.scrollHeight : scroll;
    truncated.hidden = !next.truncated;
    view = next; connected = true;
    label.textContent = `${next.sessionLabel} · 当前 Pi / ${boardId}`;
    limitation.textContent = '音乐模式仅开放当前白板工具。Pi 的确认框仍需在终端处理。';
    status.textContent = titles[next.phase]; panel.dataset.phase = next.phase;
    if (pending && next.submission?.id === pending.id && ['observed', 'settled'].includes(next.submission.state)) {
      if (input.value === pending.text) input.value = '';
      pending = undefined;
    }
    feedback.textContent = next.notice;
    buttons();
  }
  async function connect() {
    const generation = ++connectionGeneration;
    events?.close(); connected = false; buttons();
    if (!binding) {
      status.textContent = '未连接。请在已加载扩展且空闲的 Pi 中运行 /audioharness ' + boardId + '，使用一次性链接配对。独立服务只提供白板。';
      return;
    }
    const base = `/api/chat/${binding}`;
    try {
      const response = await fetch(base, { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error('Not connected');
      const next = ChatViewSchema.parse(await response.json());
      if (generation !== connectionGeneration) return;
      apply(next);
      events = new EventSource(`${base}/events`);
      events.addEventListener('snapshot', event => {
        if (generation !== connectionGeneration) return;
        try { apply(ChatViewSchema.parse(JSON.parse(event.data))); }
        catch { events?.close(); connected = false; status.textContent = '收到无效对话数据，已断开。'; buttons(); }
      });
      events.addEventListener('error', () => {
        if (generation !== connectionGeneration) return;
        connected = false; status.textContent = '对话连接中断。正在重新读取，不会重新发送消息。'; buttons();
      });
    } catch {
      if (generation !== connectionGeneration) return;
      connected = false; status.textContent = '私有连接已失效或服务离线。请在 Pi 中 off 后重新连接。草稿仍保留。'; buttons();
    }
  }
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (send.disabled || !view || !binding) return;
    const command = { kind: 'send', id: crypto.randomUUID(), epoch: view.epoch, idleVersion: view.idleVersion, text: input.value };
    pending = { id: command.id, text: command.text }; awaitingReceipt = true; buttons();
    void fetch(`/api/chat/${binding}/command`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(command), signal: AbortSignal.timeout(15_000) }).then(async response => {
      if (!response.ok) { pending = undefined; feedback.textContent = '未提交。Pi 状态可能已变化；请读取最新状态后再发送。'; await connect(); return; }
      ReceiptSchema.parse(await response.json());
      if (pending?.id === command.id) feedback.textContent = '已提交，不代表模型已经完成。草稿会在观察到消息后清除。';
    }).catch(() => { if (pending?.id === command.id) feedback.textContent = '网络错误，发送结果不确定。不会重发；请检查对话或终端后再决定。'; }).finally(() => { awaitingReceipt = false; buttons(); });
  });
  input.addEventListener('input', buttons);
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); if (!send.disabled) form.requestSubmit(); }
  });
  abort.addEventListener('click', () => {
    if (!binding || !view?.runId || abort.disabled) return;
    const command = { kind: 'abort', id: crypto.randomUUID(), epoch: view.epoch, runId: view.runId };
    abort.disabled = true;
    void fetch(`/api/chat/${binding}/command`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(command), signal: AbortSignal.timeout(15_000) }).then(async response => {
      feedback.textContent = response.ok ? '已请求停止，等待 Pi 结束。' : '该轮回复已变化，未取消新的运行。';
      await connect();
    }).catch(() => { feedback.textContent = '停止请求结果不确定。请检查 Pi；不会自动重试。'; });
  });
  retry.addEventListener('click', () => { void connect(); });
  window.addEventListener('pagehide', () => { connectionGeneration++; events?.close(); });
  void (async () => {
    if (invitation) {
      const [id, secret] = invitation.split('.');
      invitation = '';
      const input = PairSchema.safeParse({ binding: id, invitation: secret });
      if (!input.success) { status.textContent = '配对链接无效。请从 Pi 获取新链接。'; return; }
      try {
        const response = await fetch('/api/chat/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input.data), signal: AbortSignal.timeout(15_000) });
        if (!response.ok) throw new Error('Pair failed');
        binding = input.data.binding; save(bindingKey, binding);
      } catch { status.textContent = '配对失败，链接可能已使用或过期。请在 Pi 中重新连接。'; return; }
    } else {
      const saved = BindingSchema.safeParse(stored(bindingKey));
      if (saved.success) binding = saved.data;
    }
    await connect();
  })();
}
