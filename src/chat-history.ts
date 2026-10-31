import type { SessionEntry, MessageStartEvent } from '@earendil-works/pi-coding-agent';
import { CHAT_BYTES, CHAT_LIMIT, CHAT_TEXT_LIMIT, type ChatItem } from './chat-schema.js';

export function messageItems(message: MessageStartEvent['message'], id: string): ChatItem[] {
  if (message.role === 'user' || message.role === 'assistant') {
    const content = message.content;
    const text = typeof content === 'string' ? content.slice(0, CHAT_TEXT_LIMIT) : content.filter(block => block.type === 'text').map(block => block.text.slice(0, CHAT_TEXT_LIMIT)).join('\n').slice(0, CHAT_TEXT_LIMIT);
    const items: ChatItem[] = text ? [{ id, role: message.role, text }] : [];
    if (message.role === 'assistant') {
      for (const block of message.content) {
        if (block.type === 'toolCall') items.push({ id: `${id}:${block.id}`.slice(0, 160), role: 'tool', text: `${block.name.slice(0, 100)} · 调用` });
        if (items.length >= CHAT_LIMIT) break;
      }
      if (message.stopReason === 'error' || message.stopReason === 'aborted') items.push({ id: `${id}:outcome`, role: 'notice', text: message.stopReason === 'error' ? '模型请求失败。详情请在 Pi 终端查看。' : '本次回复已中止。已提交的白板更新不会撤销。' });
    }
    return items;
  }
  if (message.role === 'toolResult') return [{ id, role: 'tool', text: `${message.toolName.slice(0, 100)} · ${message.isError ? '失败' : '完成'}` }];
  return [];
}

export function boundItems(items: ChatItem[], alreadyTruncated = false) {
  let bytes = 0;
  const kept: ChatItem[] = [];
  for (let index = items.length - 1; index >= 0 && kept.length < CHAT_LIMIT; index--) {
    const item = items[index];
    if (!item) break;
    const size = Buffer.byteLength(JSON.stringify(item));
    if (bytes + size > CHAT_BYTES) break;
    bytes += size; kept.push(item);
  }
  return { items: kept.reverse(), truncated: alreadyTruncated || kept.length < items.length || kept.some(item => item.text.length === CHAT_TEXT_LIMIT) };
}

export function branchHistory(branch: SessionEntry[]) {
  const items: ChatItem[] = [];
  let start = branch.length - 1;
  for (; start >= 0 && items.length < CHAT_LIMIT; start--) {
    const entry = branch[start];
    if (!entry) break;
    if (entry.type === 'message') items.unshift(...messageItems(entry.message, entry.id));
    else if (entry.type === 'compaction') items.unshift({ id: entry.id, role: 'notice', text: 'Pi 已压缩模型上下文。这里仍显示当前分支的原始对话。' });
  }
  return boundItems(items, start >= 0);
}
