import { mountChat } from './chat-web.js';
import { scheduleChord, type Playback } from './audio.js';
import { catalogue, notesFor, startFretFor, stringsFor, type ChordSymbol } from './music.js';
import { BoardIdSchema, BoardSchema, type Board } from './schema.js';

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function required(id: string) {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing page element ${id}`);
  return node;
}
const title = required('title');
const description = required('description');
const groups = required('groups');
const tempoLabel = required('tempo');
const feedback = required('feedback');
const connection = required('connection');
const stopButton = document.querySelector<HTMLButtonElement>('#stop');
if (!stopButton) throw new Error('Missing stop button');
const stopControl = stopButton;
let board: Board | undefined;
let context: AudioContext | undefined;
let playbacks: Playback[] = [];
let timers: ReturnType<typeof setTimeout>[] = [];
let generation = 0;

function stopPlayback() {
  generation++;
  for (const playback of playbacks) playback.stop();
  for (const timer of timers) clearTimeout(timer);
  playbacks = []; timers = [];
  for (const active of document.querySelectorAll('.is-active')) active.classList.remove('is-active');
  for (const pressed of document.querySelectorAll('[aria-pressed="true"]')) pressed.setAttribute('aria-pressed', 'false');
  stopControl.disabled = true;
}
stopControl.addEventListener('click', () => { stopPlayback(); feedback.textContent = '已停止播放。'; });

async function play(sequence: { symbol: ChordSymbol; button: HTMLButtonElement }[], tempo: number) {
  stopPlayback();
  const currentGeneration = generation;
  try {
    context ??= new AudioContext();
    await context.resume();
    if (currentGeneration !== generation) return;
    const audio = context;
    const start = audio.currentTime + 0.05;
    const step = 60 / tempo * 2;
    stopControl.disabled = false;
    const activate = (button?: HTMLButtonElement) => {
      for (const item of sequence) { item.button.classList.remove('is-active'); item.button.setAttribute('aria-pressed', 'false'); }
      if (button) { button.classList.add('is-active'); button.setAttribute('aria-pressed', 'true'); }
    };
    for (const [index, item] of sequence.entries()) {
      const at = start + index * step;
      playbacks.push(scheduleChord(audio, notesFor(item.symbol), at));
      timers.push(setTimeout(() => activate(item.button), Math.max(0, (at - audio.currentTime) * 1000)));
    }
    void Promise.all(playbacks.map(playback => playback.finished)).then(() => {
      if (currentGeneration !== generation) return;
      activate(); playbacks = [];
      for (const timer of timers) clearTimeout(timer);
      timers = []; stopControl.disabled = true;
      feedback.textContent = '播放已结束。点击和弦或整组可以再听。';
    });
    feedback.textContent = sequence.length === 1 ? `正在听 ${sequence[0]?.symbol} · 合成拨弦` : `正在按 ${tempo} BPM 播放，每个和弦两拍。`;
  } catch {
    stopPlayback();
    feedback.textContent = '浏览器无法启动音频。请确认允许此页面播放声音后重试。';
  }
}

function svgNode<K extends keyof SVGElementTagNameMap>(tag: K, attributes: Record<string, string>, text?: string): SVGElementTagNameMap[K] {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  if (text !== undefined) node.textContent = text;
  return node;
}
function diagram(symbol: ChordSymbol) {
  const start = startFretFor(symbol);
  const svg = svgNode('svg', { viewBox: '0 0 208 212', class: 'diagram', role: 'img', 'aria-label': `${symbol}，从第 ${start} 品开始，低 E 至高 E 指法 ${catalogue[symbol].frets.map(fret => fret === null ? '不弹' : fret).join('、')}` });
  const x = (index: number) => 48 + index * 23;
  for (let fret = 0; fret <= 4; fret++) {
    svg.append(svgNode('line', { x1: '48', y1: String(46 + fret * 32), x2: '163', y2: String(46 + fret * 32), class: fret === 0 && start === 1 ? 'nut' : 'fret' }));
  }
  for (let string = 0; string < 6; string++) {
    svg.append(svgNode('line', { x1: String(x(string)), y1: '46', x2: String(x(string)), y2: '174', class: 'string', 'stroke-width': String(1.7 - string * 0.18) }));
    svg.append(svgNode('text', { x: String(x(string)), y: '199', class: 'string-label' }, ['E', 'A', 'D', 'G', 'B', 'e'][string]));
  }
  for (let fret = 0; fret < 4; fret++) svg.append(svgNode('text', { x: '24', y: String(67 + fret * 32), class: 'fret-label' }, String(start + fret)));
  const frets = catalogue[symbol].frets;
  frets.forEach((fret, index) => {
    if (fret === null || fret === 0) svg.append(svgNode('text', { x: String(x(index)), y: '29', class: 'open-mark' }, fret === null ? '×' : '○'));
    else svg.append(svgNode('circle', { cx: String(x(index)), cy: String(46 + (fret - start + 0.5) * 32), r: '8.5', class: 'finger' }));
  });
  return svg;
}

function render(next: Board) {
  const focused = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.focus : undefined;
  const oldRevision = board?.revision;
  stopPlayback();
  board = next;
  document.title = `${next.content.title} · AudioHarness`;
  title.textContent = next.content.title;
  description.textContent = next.content.description ?? '';
  description.hidden = !next.content.description;
  tempoLabel.textContent = `${next.content.tempo} BPM · 每和弦两拍`;
  const fragment = document.createDocumentFragment();
  for (const [groupIndex, group] of next.content.groups.entries()) {
    const section = element('section', `group ${groupIndex % 2 ? 'comparison' : ''}`);
    const header = element('div', 'group-header');
    const heading = element('div');
    const label = element('p', 'group-label', `对照 ${String.fromCharCode(65 + groupIndex)}`);
    const headingNode = element('h2', '', group.title);
    headingNode.id = `group-${group.id}`;
    section.setAttribute('aria-labelledby', headingNode.id);
    heading.append(label, headingNode);
    const playButton = element('button', 'play-group', '▶ 播放整组');
    playButton.type = 'button'; playButton.dataset.focus = `group:${group.id}`;
    playButton.setAttribute('aria-label', `播放整组 ${group.title}`);
    header.append(heading, playButton); section.append(header);
    if (group.description) section.append(element('p', 'group-description', group.description));
    const progression = element('div', 'progression');
    const sequence: { symbol: ChordSymbol; button: HTMLButtonElement }[] = [];
    group.chords.forEach((symbol, index) => {
      const card = element('button', 'chord');
      card.type = 'button'; card.dataset.symbol = symbol; card.dataset.focus = `${group.id}:${index}`;
      card.setAttribute('aria-label', `聆听 ${symbol}，${group.title} 第 ${index + 1} 个和弦`);
      card.setAttribute('aria-pressed', 'false');
      const cardTitle = element('span', 'chord-heading');
      cardTitle.append(element('span', 'chord-number', String(index + 1).padStart(2, '0')), element('span', 'chord-name', symbol), element('span', 'listen', '▶'));
      const notes = element('span', 'notes');
      for (const string of stringsFor(symbol)) notes.append(element('span', string.midi === null ? 'muted' : '', string.pitch));
      card.append(cardTitle, diagram(symbol), notes, element('span', 'listen-label', '点击聆听'));
      card.addEventListener('click', () => { void play([{ symbol, button: card }], next.content.tempo); });
      sequence.push({ symbol, button: card }); progression.append(card);
    });
    playButton.addEventListener('click', () => { void play(sequence, next.content.tempo); });
    section.append(progression); fragment.append(section);
  }
  groups.replaceChildren(fragment);
  if (focused) {
    for (const candidate of groups.querySelectorAll<HTMLElement>('[data-focus]')) if (candidate.dataset.focus === focused) { candidate.focus({ preventScroll: true }); break; }
  }
  feedback.textContent = oldRevision === undefined ? '白板已就绪。选一个和弦，开始听。' : `白板已更新至第 ${next.revision} 版。旧播放已停止，点击后再听。`;
  document.body.dataset.revision = String(next.revision);
}

function setConnection(state: 'connecting' | 'connected' | 'disconnected') {
  connection.dataset.state = state;
  connection.textContent = { connecting: '正在连接', connected: '实时连接', disconnected: '连接中断 · 正在重试' }[state];
}
const id = BoardIdSchema.safeParse(location.pathname.slice(3));
if (!id.success) {
  title.textContent = '白板地址无效'; setConnection('disconnected');
} else {
  mountChat(id.data);
  const events = new EventSource(`/api/boards/${id.data}/events`);
  events.addEventListener('open', () => setConnection('connected'));
  events.addEventListener('snapshot', event => {
    try {
      const next = BoardSchema.parse(JSON.parse(event.data));
      if (next.id !== id.data) throw new Error('Wrong board');
      if (!board || next.revision > board.revision) render(next);
      setConnection('connected');
    } catch { feedback.textContent = '收到无效白板数据，未应用更新。'; setConnection('disconnected'); }
  });
  events.addEventListener('error', () => {
    setConnection('disconnected');
    if (!board) { title.textContent = '暂时无法打开白板'; description.textContent = '服务可能已停止，或这个白板还不存在。请让 agent 检查白板地址。'; }
  });
  window.addEventListener('pagehide', () => { events.close(); stopPlayback(); void context?.close(); });
  window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
}
