import type { ChatItem, ChatView } from './chat-schema.js';

export type Locale = 'en' | 'zh-CN';
export const LOCALE_KEY = 'tele.locale';
export const en = {
  pageTitle: 'Tele · A Harness for Musical Interaction',
  boardTitle: (title: string) => `${title} · Tele`,
  static: {
    wordmark: 'Chord listening board',
    eyebrow: 'Turn harmony explanations into comparisons you can hear.',
    loadingTitle: 'Opening your chord board',
    loadingDescription: 'Please wait while the board loads.',
    instruction: 'Click a chord to listen, or play the whole group in order.',
    stop: '■ Stop playback',
    tuning: 'Standard tuning · No capo',
    synthesis: 'Synthesized plucks, not a guitar recording',
    footer: 'Hear the difference, then return to the music.',
    diagramKey: 'Low E → high E, left to right · × muted · ○ open string',
  },
  language: 'Language',
  connection: { connecting: 'Connecting', connected: 'Live connection', disconnected: 'Disconnected · Retrying' },
  stopped: 'Playback stopped.',
  ended: 'Playback ended. Click a chord or group to listen again.',
  playingChord: (symbol: string) => `Listening to ${symbol} · Synthesized plucks`,
  playingGroup: (tempo: number) => `Playing at ${tempo} BPM, two beats per chord.`,
  audioFailed: 'The browser could not start audio. Allow sound on this page and try again.',
  diagram: (symbol: string, start: number, frets: readonly (number | null)[]) => `${symbol}, starting at fret ${start}, low E to high E fingering ${frets.map(fret => fret === null ? 'muted' : fret).join(', ')}`,
  tempo: (tempo: number) => `${tempo} BPM · Two beats per chord`,
  comparison: (letter: string) => `Comparison ${letter}`,
  playGroup: '▶ Play group',
  playGroupLabel: (title: string) => `Play group ${title}`,
  listenLabel: (symbol: string, title: string, index: number) => `Listen to ${symbol}, chord ${index} in ${title}`,
  listen: 'Click to listen',
  ready: 'Board ready. Choose a chord to start listening.',
  updated: (revision: number) => `Board updated to revision ${revision}. Old playback stopped. Click to listen again.`,
  invalidAddress: 'Invalid board address',
  invalidBoard: 'Invalid board data received. The update was not applied.',
  unavailable: 'Cannot open the board right now',
  unavailableDescription: 'The service may have stopped, or this board may not exist. Ask your agent to check the board address.',
  chat: {
    panel: 'Pi conversation', title: 'Talk about music', collapse: 'Collapse', expand: 'Expand chat',
    unconnected: 'Pi not connected', position: 'Position ', dock: 'Conversation panel position',
    docks: { right: 'Right', left: 'Left', bottom: 'Bottom' },
    limitation: 'Music mode allows only the current board tool. Pi confirmation dialogs still require the terminal.',
    history: 'Current branch conversation history',
    truncated: 'Only recent history is shown. Long messages may be truncated. The complete record remains in Pi.',
    input: 'Continue the conversation', placeholder: 'What change would you like to hear? Shift+Enter for a new line',
    send: 'Send', abort: 'Stop reply', retry: 'Read latest status',
    roles: { user: 'You', assistant: 'Pi', tool: 'Tool', notice: 'Notice' },
    tool: { calling: 'Calling', completed: 'Completed', failed: 'Failed' } satisfies Record<Extract<ChatItem, { role: 'tool' }>['status'], string>,
    phases: {
      idle: 'Ready to continue', submitted: 'Submitted, awaiting Pi confirmation', busy: 'Pi is replying', stopping: 'Waiting for Pi to stop',
      'terminal-required': 'Terminal action required. The browser cannot confirm for you.', uncertain: 'Submission uncertain. Check the terminal.', disconnected: 'Pi disconnected',
    } satisfies Record<ChatView['phase'], string>,
    session: (name: string, boardId: string) => `${name} · Current Pi / ${boardId}`,
    attach: (boardId: string) => `Not connected. Run /tele ${boardId} in an idle Pi with the extension loaded, then pair using its one-time link. The standalone service provides only boards.`,
    invalidData: 'Invalid conversation data received. Disconnected.',
    interrupted: 'Conversation connection interrupted. Reading again, without resending messages.',
    offline: 'Private connection expired or service offline. Run /tele off in Pi, then attach again. Your draft is preserved.',
    rejected: 'Not submitted. Pi state may have changed. Read the latest status before sending again.',
    submitted: 'Submitted does not mean the model has finished. The draft clears when the message is observed.',
    networkUncertain: 'Network error. Submission is uncertain and will not be resent. Check the conversation or terminal before deciding.',
    stopRequested: 'Stop requested. Waiting for Pi to finish.',
    staleStop: 'The reply has changed. The new run was not cancelled.',
    stopUncertain: 'Stop request outcome uncertain. Check Pi. There is no automatic retry.',
    invalidPair: 'Invalid pairing link. Get a new link from Pi.',
    pairFailed: 'Pairing failed. The link may be used or expired. Attach again in Pi.',
  },
  historyNotices: {
    'context-compacted': 'Pi compacted the model context. This view still shows the original conversation on the current branch.',
    'model-failed': 'The model request failed. See the Pi terminal for details.',
    'reply-aborted': 'This reply was aborted. Committed board updates are not rolled back.',
  } satisfies Record<Extract<ChatItem, { role: 'notice' }>['code'], string>,
  notices: {
    'input-submitted': 'Submitted to Pi, but not yet confirmed in the conversation. There is no automatic resend.',
    'input-unobserved': 'Input was not observed. Another extension may have handled it, or submission may have failed. Check the terminal and, if needed, run /tele off and attach again. There is no resend.',
    'submission-uncertain': 'Submission uncertain. Check the Pi terminal. There is no automatic resend.',
    'stop-requested': 'Stop requested. Waiting for Pi to finish. A terminal dialog may still need attention.',
    'input-observed': 'This input was observed in the Pi conversation.',
    'settled-unobserved': 'Pi finished, but the browser input was not confirmed in the conversation. Check history. There is no resend.',
    'run-ended': 'This Pi run has finished.',
  } satisfies Record<NonNullable<ChatView['notice']>, string>,
};
type Dictionary<T> = { [K in keyof T]: T[K] extends (...args: infer A) => string ? (...args: A) => string : T[K] extends string ? string : Dictionary<T[K]> };
export type Messages = Dictionary<typeof en>;
export const zhCN = {
  pageTitle: 'Tele · 为大模型提供音乐交互组件',
  boardTitle: (title: string) => `${title} · Tele`,
  static: {
    wordmark: '和弦听觉白板', eyebrow: '把和声讲解，变成可以听见的对照。', loadingTitle: '正在打开你的和弦白板',
    loadingDescription: '请稍候，正在读取白板。', instruction: '点击和弦听声音，或按顺序播放整组。', stop: '■ 停止播放',
    tuning: '标准调弦 · 无变调夹', synthesis: '合成拨弦，非吉他录音', footer: '听见差异，再回到音乐里。',
    diagramKey: '指板从左至右为低 E → 高 E · × 不弹 · ○ 空弦',
  },
  language: '语言',
  connection: { connecting: '正在连接', connected: '实时连接', disconnected: '连接中断 · 正在重试' },
  stopped: '已停止播放。', ended: '播放已结束。点击和弦或整组可以再听。',
  playingChord: (symbol: string) => `正在听 ${symbol} · 合成拨弦`,
  playingGroup: (tempo: number) => `正在按 ${tempo} BPM 播放，每个和弦两拍。`,
  audioFailed: '浏览器无法启动音频。请确认允许此页面播放声音后重试。',
  diagram: (symbol: string, start: number, frets: readonly (number | null)[]) => `${symbol}，从第 ${start} 品开始，低 E 至高 E 指法 ${frets.map(fret => fret === null ? '不弹' : fret).join('、')}`,
  tempo: (tempo: number) => `${tempo} BPM · 每和弦两拍`, comparison: (letter: string) => `对照 ${letter}`,
  playGroup: '▶ 播放整组', playGroupLabel: (title: string) => `播放整组 ${title}`,
  listenLabel: (symbol: string, title: string, index: number) => `聆听 ${symbol}，${title} 第 ${index} 个和弦`, listen: '点击聆听',
  ready: '白板已就绪。选一个和弦，开始听。', updated: (revision: number) => `白板已更新至第 ${revision} 版。旧播放已停止，点击后再听。`,
  invalidAddress: '白板地址无效', invalidBoard: '收到无效白板数据，未应用更新。', unavailable: '暂时无法打开白板',
  unavailableDescription: '服务可能已停止，或这个白板还不存在。请让 agent 检查白板地址。',
  chat: {
    panel: 'Pi 对话', title: '一起聊音乐', collapse: '收起', expand: '展开对话', unconnected: '未连接 Pi', position: '位置 ', dock: '对话面板位置',
    docks: { right: '右侧', left: '左侧', bottom: '底部' },
    limitation: '音乐模式仅开放当前白板工具。Pi 的确认框仍需在终端处理。', history: '当前分支对话历史',
    truncated: '仅显示最近的部分历史，长消息可能截断。完整记录仍在 Pi。', input: '继续对话', placeholder: '想听哪种变化？Shift+Enter 换行',
    send: '发送', abort: '停止回复', retry: '重新读取状态', roles: { user: '你', assistant: 'Pi', tool: '工具', notice: '提示' },
    tool: { calling: '调用', completed: '完成', failed: '失败' },
    phases: { idle: '可以继续对话', submitted: '已提交，等待 Pi 确认', busy: 'Pi 正在回复', stopping: '正在等待停止', 'terminal-required': '需要终端操作，浏览器不能代为确认', uncertain: '提交结果不确定，请检查终端', disconnected: 'Pi 已断开' },
    session: (name: string, boardId: string) => `${name} · 当前 Pi / ${boardId}`,
    attach: (boardId: string) => `未连接。请在已加载扩展且空闲的 Pi 中运行 /tele ${boardId}，使用一次性链接配对。独立服务只提供白板。`,
    invalidData: '收到无效对话数据，已断开。', interrupted: '对话连接中断。正在重新读取，不会重新发送消息。',
    offline: '私有连接已失效或服务离线。请在 Pi 中 off 后重新连接。草稿仍保留。',
    rejected: '未提交。Pi 状态可能已变化；请读取最新状态后再发送。', submitted: '已提交，不代表模型已经完成。草稿会在观察到消息后清除。',
    networkUncertain: '网络错误，发送结果不确定。不会重发；请检查对话或终端后再决定。', stopRequested: '已请求停止，等待 Pi 结束。',
    staleStop: '该轮回复已变化，未取消新的运行。', stopUncertain: '停止请求结果不确定。请检查 Pi；不会自动重试。',
    invalidPair: '配对链接无效。请从 Pi 获取新链接。', pairFailed: '配对失败，链接可能已使用或过期。请在 Pi 中重新连接。',
  },
  historyNotices: { 'context-compacted': 'Pi 已压缩模型上下文。这里仍显示当前分支的原始对话。', 'model-failed': '模型请求失败。详情请在 Pi 终端查看。', 'reply-aborted': '本次回复已中止。已提交的白板更新不会撤销。' },
  notices: {
    'input-submitted': '已提交给 Pi，尚未确认进入对话。不会自动重发。',
    'input-unobserved': '未观察到输入。可能被其他扩展处理或提交失败；不会重发。请在终端检查，必要时 off 后重新连接。',
    'submission-uncertain': '提交结果不确定。请检查 Pi 终端，不会自动重发。',
    'stop-requested': '已请求停止。等待 Pi 实际结束；终端对话框可能仍需操作。', 'input-observed': '已观察到本次输入进入 Pi 对话。',
    'settled-unobserved': 'Pi 已结束，但未确认浏览器输入进入对话。请检查历史，不会重发。', 'run-ended': 'Pi 本次运行已结束。',
  },
} satisfies Messages;

export function itemText(item: ChatItem, messages: Messages): string {
  switch (item.role) {
    case 'user': case 'assistant': return item.text;
    case 'tool': return `${item.name} · ${messages.chat.tool[item.status]}`;
    case 'notice': return messages.historyNotices[item.code];
    default: { const exhaustive: never = item; return exhaustive; }
  }
}
export function initialLocale(saved: unknown, languages: readonly string[]): Locale {
  if (saved === 'en' || saved === 'zh-CN') return saved;
  return languages[0]?.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
}
type LocaleStorage = Pick<Storage, 'getItem' | 'setItem'>;
export function createLocale(storage: () => LocaleStorage, languages: readonly string[]) {
  let saved: unknown;
  try { saved = storage().getItem(LOCALE_KEY); } catch { }
  let current = initialLocale(saved, languages);
  const listeners = new Set<() => void>();
  return {
    get current() { return current; },
    get messages(): Messages { return current === 'en' ? en : zhCN; },
    set(value: unknown) {
      if (value !== 'en' && value !== 'zh-CN') return;
      try { storage().setItem(LOCALE_KEY, value); } catch { }
      if (current === value) return;
      current = value;
      for (const listener of listeners) listener();
    },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
