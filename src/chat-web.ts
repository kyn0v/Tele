import { BindingSchema, ChatViewSchema, PairSchema, ReceiptSchema, type ChatView, type Binding } from './chat-schema.js';
import type { BoardId } from './schema.js';
import { itemText } from './i18n.js';
import { locale, liveText, liveAttribute } from './locale-web.js';

let invitation = location.hash.startsWith('#chat=') ? location.hash.slice(6) : '';
if (invitation) history.replaceState(null, '', location.pathname + location.search);
function node<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = '') {
  const element = document.createElement(tag); element.className = className; element.textContent = text; return element;
}
function stored(key: string) { try { return localStorage.getItem(key); } catch { return null; } }
function save(key: string, value: string) { try { localStorage.setItem(key, value); } catch { } }

export function mountChat(boardId: BoardId) {
  const panel = node('aside', 'chat-panel'); liveAttribute(panel, 'aria-label', () => locale.messages.chat.panel);
  const header = node('div', 'chat-header');
  const heading = node('h2', 'chat-title'); liveText(heading, () => locale.messages.chat.title);
  const collapse = node('button', 'chat-collapse'); collapse.type = 'button';
  collapse.setAttribute('aria-controls', 'chat-body');
  header.append(heading, collapse);
  const body = node('div', 'chat-body'); body.id = 'chat-body';
  const label = node('p', 'chat-session'); const setSession = liveText(label, () => locale.messages.chat.unconnected);
  const controls = node('div', 'chat-controls');
  const dockLabel = node('label', '');
  const position = node('span', ''); liveText(position, () => locale.messages.chat.position); dockLabel.append(position);
  const dock = node('select', 'chat-dock'); liveAttribute(dock, 'aria-label', () => locale.messages.chat.dock);
  for (const value of ['right', 'left', 'bottom'] satisfies (keyof typeof locale.messages.chat.docks)[]) {
    const option = node('option', ''); liveText(option, () => locale.messages.chat.docks[value]); option.value = value; dock.append(option);
  }
  const preference = stored('tele.chat.dock');
  dock.value = preference === 'left' || preference === 'bottom' ? preference : 'right';
  dockLabel.append(dock); controls.append(dockLabel);
  const status = node('p', 'chat-status'); status.setAttribute('role', 'status'); const setStatus = liveText(status);
  const limitation = node('p', 'chat-limitation'); liveText(limitation, () => locale.messages.chat.limitation);
  const historyNode = node('div', 'chat-history'); historyNode.tabIndex = 0; liveAttribute(historyNode, 'aria-label', () => locale.messages.chat.history);
  const truncated = node('p', 'chat-truncated'); liveText(truncated, () => locale.messages.chat.truncated); truncated.hidden = true;
  const form = node('form', 'chat-composer');
  const inputLabel = node('label', ''); liveText(inputLabel, () => locale.messages.chat.input); inputLabel.htmlFor = 'chat-input';
  const input = node('textarea', 'chat-input'); input.id = 'chat-input'; input.rows = 3; input.maxLength = 8000; liveAttribute(input, 'placeholder', () => locale.messages.chat.placeholder);
  const actions = node('div', 'chat-actions');
  const send = node('button', 'chat-send'); liveText(send, () => locale.messages.chat.send); send.type = 'submit'; send.disabled = true;
  const abort = node('button', 'chat-abort'); liveText(abort, () => locale.messages.chat.abort); abort.type = 'button'; abort.disabled = true;
  const retry = node('button', 'chat-reconnect'); liveText(retry, () => locale.messages.chat.retry); retry.type = 'button';
  actions.append(send, abort); form.append(inputLabel, input, actions);
  const feedback = node('p', 'chat-feedback'); feedback.setAttribute('role', 'status'); const setFeedback = liveText(feedback);
  body.append(label, controls, status, limitation, truncated, historyNode, form, feedback, retry);
  panel.append(header, body); document.body.append(panel);
  let collapsed = stored('tele.chat.collapsed') === 'true';
  function layout() {
    document.body.dataset.chatDock = dock.value;
    document.body.dataset.chatCollapsed = String(collapsed);
    body.hidden = collapsed;
    collapse.textContent = collapsed ? locale.messages.chat.expand : locale.messages.chat.collapse;
    collapse.setAttribute('aria-expanded', String(!collapsed));
  }
  dock.addEventListener('change', () => { save('tele.chat.dock', dock.value); layout(); });
  collapse.addEventListener('click', () => { collapsed = !collapsed; save('tele.chat.collapsed', String(collapsed)); layout(); });
  layout(); locale.subscribe(layout);
  let binding: Binding | undefined;
  let view: ChatView | undefined;
  let events: EventSource | undefined;
  let connected = false;
  let pending: { id: string; text: string } | undefined;
  let awaitingReceipt = false;
  let connectionGeneration = 0;
  const bindingKey = `tele.chat.binding:${boardId}`;
  function itemLabels(entry: Element, item: ChatView['items'][number]) {
    const role = entry.querySelector('.chat-role'); if (role) role.textContent = locale.messages.chat.roles[item.role];
    const text = entry.querySelector('.chat-text');
    const value = itemText(item, locale.messages);
    if (text && text.textContent !== value) text.textContent = value;
  }
  locale.subscribe(() => {
    if (!view) return;
    const scroll = historyNode.scrollTop;
    for (const [index, item] of view.items.entries()) {
      const entry = historyNode.children[index]; if (entry) itemLabels(entry, item);
    }
    historyNode.scrollTop = scroll;
  });
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
        entry.append(node('span', 'chat-role'), node('p', 'chat-text'));
      }
      itemLabels(entry, item);
      historyNode.append(entry);
    }
    historyNode.scrollTop = pinned ? historyNode.scrollHeight : scroll;
    truncated.hidden = !next.truncated;
    view = next; connected = true;
    setSession(() => locale.messages.chat.session(next.sessionLabel, boardId));
    setStatus(() => locale.messages.chat.phases[next.phase]); panel.dataset.phase = next.phase;
    if (pending && next.submission?.id === pending.id && ['observed', 'settled'].includes(next.submission.state)) {
      if (input.value === pending.text) input.value = '';
      pending = undefined;
    }
    setFeedback(() => next.notice === null ? '' : locale.messages.notices[next.notice]);
    buttons();
  }
  async function connect() {
    const generation = ++connectionGeneration;
    events?.close(); connected = false; buttons();
    if (!binding) {
      setStatus(() => locale.messages.chat.attach(boardId));
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
        catch { events?.close(); connected = false; setStatus(() => locale.messages.chat.invalidData); buttons(); }
      });
      events.addEventListener('error', () => {
        if (generation !== connectionGeneration) return;
        connected = false; setStatus(() => locale.messages.chat.interrupted); buttons();
      });
    } catch {
      if (generation !== connectionGeneration) return;
      connected = false; setStatus(() => locale.messages.chat.offline); buttons();
    }
  }
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (send.disabled || !view || !binding) return;
    const command = { kind: 'send', id: crypto.randomUUID(), epoch: view.epoch, idleVersion: view.idleVersion, text: input.value };
    pending = { id: command.id, text: command.text }; awaitingReceipt = true; buttons();
    void fetch(`/api/chat/${binding}/command`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(command), signal: AbortSignal.timeout(15_000) }).then(async response => {
      if (!response.ok) { pending = undefined; setFeedback(() => locale.messages.chat.rejected); await connect(); return; }
      ReceiptSchema.parse(await response.json());
      if (pending?.id === command.id) setFeedback(() => locale.messages.chat.submitted);
    }).catch(() => { if (pending?.id === command.id) setFeedback(() => locale.messages.chat.networkUncertain); }).finally(() => { awaitingReceipt = false; buttons(); });
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
      setFeedback(() => response.ok ? locale.messages.chat.stopRequested : locale.messages.chat.staleStop);
      await connect();
    }).catch(() => { setFeedback(() => locale.messages.chat.stopUncertain); });
  });
  retry.addEventListener('click', () => { void connect(); });
  window.addEventListener('pagehide', () => { connectionGeneration++; events?.close(); });
  void (async () => {
    if (invitation) {
      const [id, secret] = invitation.split('.');
      invitation = '';
      const input = PairSchema.safeParse({ binding: id, invitation: secret });
      if (!input.success) { setStatus(() => locale.messages.chat.invalidPair); return; }
      try {
        const response = await fetch('/api/chat/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input.data), signal: AbortSignal.timeout(15_000) });
        if (!response.ok) throw new Error('Pair failed');
        binding = input.data.binding; save(bindingKey, binding);
      } catch { setStatus(() => locale.messages.chat.pairFailed); return; }
    } else {
      const saved = BindingSchema.safeParse(stored(bindingKey));
      if (saved.success) binding = saved.data;
    }
    await connect();
  })();
}
