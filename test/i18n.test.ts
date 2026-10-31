import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLocale, en, zhCN, initialLocale, itemText, LOCALE_KEY } from '../src/i18n.js';
import { ChatItemSchema } from '../src/chat-schema.js';

function paths(value: object, prefix = ''): string[] {
  return Object.entries(value).flatMap(([key, child]) => {
    const path = `${prefix}${key}`;
    if (typeof child === 'string') { assert(child.length > 0, path); return [path]; }
    if (typeof child === 'function') return [`${path}(${child.length})`];
    assert(child && typeof child === 'object', path);
    return paths(child, `${path}.`);
  }).sort();
}
test('both dictionaries cover the same labels and parameter signatures', () => {
  assert.deepEqual(paths(zhCN), paths(en));
  assert.equal(en.updated(7), 'Board updated to revision 7. Old playback stopped. Click to listen again.');
  assert.equal(zhCN.updated(7), '白板已更新至第 7 版。旧播放已停止，点击后再听。');
  assert.equal(en.diagram('D', 1, [null, null, 0, 2, 3, 2]), 'D, starting at fret 1, low E to high E fingering muted, muted, 0, 2, 3, 2');
  assert.equal(zhCN.diagram('D', 1, [null, null, 0, 2, 3, 2]), 'D，从第 1 品开始，低 E 至高 E 指法 不弹、不弹、0、2、3、2');
  for (const messages of [en, zhCN]) {
    for (const label of [messages.playingChord('Gm'), messages.playGroupLabel('Private group'), messages.listenLabel('Gm', 'Private group', 3), messages.boardTitle('Private board'), messages.chat.session('Private session', 'test-board'), messages.chat.attach('test-board'), messages.comparison('Q')]) {
      assert(label.length > 0);
    }
    assert(messages.chat.session('Private session', 'test-board').includes('Private session'));
    assert(messages.listenLabel('Gm', 'Private group', 3).includes('Private group'));
    assert(messages.playingGroup(123).includes('123 BPM'));
    assert(messages.tempo(123).includes('123 BPM'));
    assert(messages.chat.attach('test-board').includes('/tele test-board'));
  }
});
test('locale uses saved choice, browser primary language and deterministic fallback', () => {
  assert.equal(initialLocale(null, ['zh-TW', 'en-US']), 'zh-CN');
  assert.equal(initialLocale(null, ['ZH-Hans']), 'zh-CN');
  assert.equal(initialLocale(null, ['en-US', 'zh-CN']), 'en');
  assert.equal(initialLocale(null, ['fr']), 'en');
  assert.equal(initialLocale(null, []), 'en');
  assert.equal(initialLocale('invalid', ['zh']), 'zh-CN');
  assert.equal(initialLocale('zh-CN', ['en-US']), 'zh-CN');
  assert.equal(initialLocale('en', ['zh-CN']), 'en');
});
test('choice persists, invalid changes are ignored and blocked storage is safe', () => {
  const values = new Map<string, string>();
  const storage = () => ({ getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } });
  const locale = createLocale(storage, ['zh-TW']);
  let changes = 0; const unsubscribe = locale.subscribe(() => { changes++; });
  locale.set('en'); assert.equal(locale.current, 'en'); assert.equal(values.get(LOCALE_KEY), 'en');
  locale.set('en'); locale.set('garbage'); assert.equal(changes, 1);
  assert.equal(createLocale(storage, ['zh-CN']).current, 'en');
  unsubscribe(); locale.set('zh-CN'); assert.equal(changes, 1);
  const blocked = createLocale(() => { throw new Error('Storage denied'); }, ['zh']);
  assert.equal(blocked.current, 'zh-CN'); blocked.set('en'); assert.equal(blocked.messages.chat.send, 'Send');
  const writeBlocked = createLocale(() => ({ getItem: () => 'invalid', setItem: () => { throw new Error('Quota exceeded'); } }), ['en']);
  writeBlocked.set('zh-CN'); assert.equal(writeBlocked.messages.chat.send, '发送');
});
test('only semantic generated items are localized, never matching ordinary message text', () => {
  const text = 'Pi 已压缩模型上下文。这里仍显示当前分支的原始对话。';
  for (const messages of [en, zhCN]) {
    assert.equal(itemText({ id: 'u', role: 'user', text }, messages), text);
    assert.equal(itemText({ id: 'a', role: 'assistant', text }, messages), text);
  }
  assert.equal(itemText({ id: 'n', role: 'notice', code: 'context-compacted' }, en), 'Pi compacted the model context. This view still shows the original conversation on the current branch.');
  assert.equal(itemText({ id: 't', role: 'tool', name: 'tele_board', status: 'completed' }, en), 'tele_board · Completed');
  assert.equal(itemText({ id: 't', role: 'tool', name: 'tele_board', status: 'failed' }, zhCN), 'tele_board · 失败');
  assert(!ChatItemSchema.safeParse({ id: 't', role: 'tool', text: 'read · 完成' }).success);
  assert(!ChatItemSchema.safeParse({ id: 'n', role: 'notice', code: 'unknown' }).success);
  assert(!ChatItemSchema.safeParse({ id: 't', role: 'tool', name: 'read', status: 'completed', payload: 'private' }).success);
  assert(!ChatItemSchema.safeParse({ id: 't', role: 'tool', name: 'n'.repeat(101), status: 'completed' }).success);
});
