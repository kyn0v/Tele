import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { previewPi, root } from './pi-preview.mjs';
import { chromium } from 'playwright';

const directory = await mkdtemp(join(tmpdir(), 'tele-pi-probe-'));
const pi = previewPi({ directory, model: 'github-copilot/gpt-6-luna', tools: 'read,tele_board', offline: true, extensions: [`${root}test/pi-probe-extension.ts`] });
let browser;
let agentStarts = 0;
async function assertNoOverflow(page, state) {
  const diagnostic = await page.evaluate(() => {
    if (document.documentElement.scrollWidth <= innerWidth) return null;
    function measure(element) {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return { tag: element.tagName, class: element.getAttribute('class')?.slice(0, 100), rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right }, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, font: style.font, padding: style.padding, display: style.display };
    }
    return {
      viewport: { innerWidth, innerHeight, clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth, bodyWidth: document.body.clientWidth, scrollX },
      locale: document.documentElement.lang, dock: document.body.dataset.chatDock, collapsed: document.body.dataset.chatCollapsed,
      expanded: document.querySelector('.chat-collapse')?.getAttribute('aria-expanded'), bodyHidden: document.querySelector('.chat-body')?.hidden,
      userAgent: navigator.userAgent, fonts: document.fonts.status, animations: document.getAnimations().length,
      layout: ['main', '.chat-panel', '.chat-header', '.chat-collapse'].map(selector => measure(document.querySelector(selector))),
      overflow: [...document.querySelectorAll('body *')].filter(element => { const rect = element.getBoundingClientRect(); return rect.width && (rect.right > innerWidth || rect.left < 0); }).slice(0, 12).map(measure),
    };
  });
  if (diagnostic) {
    const session = await page.context().newCDPSession(page);
    await session.send('DOM.enable'); await session.send('CSS.enable');
    const { root: documentRoot } = await session.send('DOM.getDocument');
    const { nodeId } = await session.send('DOM.querySelector', { nodeId: documentRoot.nodeId, selector: '.chat-collapse' });
    diagnostic.platformFonts = (await session.send('CSS.getPlatformFontsForNode', { nodeId })).fonts;
    await session.detach();
    process.stderr.write(`${JSON.stringify({ event: 'chat-layout-overflow', state, ...diagnostic })}\n`);
    await page.screenshot({ path: `${root}.audit/chat/probe-overflow-${state}.png`, mask: [page.locator('.chat-body')] });
  }
  assert.equal(diagnostic, null, `No horizontal overflow in ${state}`);
}
pi.observe(event => { if (event.type === 'agent_start') agentStarts++; });
try {
  await pi.command('get_state');
  await pi.command('prompt', { message: '/probe-seed' });
  const invitation = new URL(await pi.attach());
  const [binding, secret] = invitation.hash.slice(6).split('.');
  const origin = invitation.origin;
  const path = `${origin}/api/chat/${binding}`;
  assert.equal((await fetch(path)).status, 401);
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  let browserCommands = 0;
  page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/command')) browserCommands++; });
  await page.goto(invitation.href).catch(() => { throw new Error('Probe pairing navigation failed'); });
  await page.waitForFunction(() => document.querySelector('.chat-panel')?.dataset.phase === 'idle');
  assert.equal(new URL(page.url()).hash, '');
  const paired = await fetch(`${origin}/api/chat/pair`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ binding, invitation: secret }) });
  assert.equal(paired.status, 401, 'Browser already consumed the invitation');
  const grant = (await page.context().cookies()).find(cookie => cookie.path === `/api/chat/${binding}`);
  assert(grant?.httpOnly); assert.equal(grant.sameSite, 'Strict');
  const cookie = `${grant.name}=${grant.value}`;
  await mkdir(`${root}.audit/chat`, { recursive: true });
  const headers = { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' };
  const view = await (await fetch(path, { headers })).json();
  const originalBoard = await (await fetch(`${origin}/api/boards/preview`)).json();
  const originalMessages = await pi.command('get_messages');
  const userNotice = 'Pi 已压缩模型上下文。这里仍显示当前分支的原始对话。';
  assert(view.items.some(item => item.role === 'user' && item.text.includes('Old canary: cobalt cadence.')));
  assert(view.items.some(item => item.role === 'notice' && item.code === 'context-compacted'));
  assert(view.items.some(item => item.role === 'tool' && item.name === 'tele_board' && item.status === 'completed'));
  assert(!JSON.stringify(view).includes('Private summary'));
  assert(!JSON.stringify(view).includes('Private raw tool payload'));
  for (const [browserLocale, saved, expected] of [['zh-TW', null, 'zh-CN'], ['en-US', null, 'en'], ['fr-FR', 'invalid', 'en'], ['en-US', 'zh-CN', 'zh-CN'], ['zh-CN', 'en', 'en']]) {
    const context = await browser.newContext({ locale: browserLocale });
    if (saved) await context.addInitScript(value => localStorage.setItem('tele.locale', value), saved);
    const fallback = await context.newPage(); await fallback.goto(`${origin}/b/preview`);
    await fallback.waitForFunction(() => document.body.dataset.revision === '1');
    assert.equal(await fallback.locator('html').getAttribute('lang'), expected);
    assert.equal(await fallback.locator('#locale').inputValue(), expected);
    await context.close();
  }
  const blockedContext = await browser.newContext({ locale: 'zh-CN' });
  await blockedContext.addInitScript(() => Object.defineProperty(window, 'localStorage', { get() { throw new Error('Storage blocked'); } }));
  const blocked = await blockedContext.newPage(); await blocked.goto(`${origin}/b/preview`);
  await blocked.waitForFunction(() => document.body.dataset.revision === '1');
  await blocked.locator('#locale').selectOption('en');
  assert.equal(await blocked.getByRole('button', { name: '■ Stop playback', exact: true }).count(), 1);
  await blockedContext.close();
  await page.locator('#chat-input').fill('保留输入 draft');
  await page.locator('#chat-input').focus();
  await page.evaluate(() => {
    window.composerProof = document.querySelector('#chat-input');
    window.composerProof.setSelectionRange(2, 4);
  });
  for (const language of ['en', 'zh-CN']) {
    await page.locator('#locale').selectOption(language);
    assert.equal(await page.locator('html').getAttribute('lang'), language);
    assert.equal(await page.locator('#locale').inputValue(), language);
    assert.equal(await page.evaluate(() => localStorage.getItem('tele.locale')), language);
    assert(await page.getByLabel(language === 'en' ? 'Language' : '语言', { exact: true }).isVisible());
    assert.equal(await page.getByLabel(language === 'en' ? 'Continue the conversation' : '继续对话', { exact: true }).count(), 1);
    assert(await page.getByRole('button', { name: language === 'en' ? 'Send' : '发送', exact: true }).isEnabled());
    assert.match(await page.locator('.chat-session').textContent(), /用户 session name/);
    assert.equal(await page.locator('.chat-user .chat-text').last().textContent(), userNotice);
    assert.match(await page.locator('.chat-notice .chat-text').textContent(), language === 'en' ? /Pi compacted the model context/ : /Pi 已压缩模型上下文/);
    assert.equal(await page.locator('.chat-tool .chat-text').textContent(), `tele_board · ${language === 'en' ? 'Completed' : '完成'}`);
    assert.match(await page.locator('.diagram').first().getAttribute('aria-label'), language === 'en' ? /muted, muted, 0, 2, 3, 2/ : /不弹、不弹、0、2、3、2/);
    assert.match(await page.locator('#tempo').textContent(), language === 'en' ? /Two beats per chord/ : /每和弦两拍/);
    assert(await page.locator('#stop').isDisabled(), 'Locale changes never autoplay');
    for (const dock of ['right', 'left', 'bottom']) {
      await page.getByLabel(language === 'en' ? 'Conversation panel position' : '对话面板位置').selectOption(dock);
      assert.equal(await page.locator('#chat-input').inputValue(), '保留输入 draft');
      assert(await page.locator('#chat-input').evaluate(input => input === window.composerProof));
      assert(await page.locator('.chat-session').isVisible());
      await assertNoOverflow(page, `${language}-${dock}`);
      await page.screenshot({ path: `${root}.audit/chat/probe-${language}-${dock}.png` });
      await page.locator('.chat-collapse').click();
      assert(await page.locator('#locale').isVisible());
      assert.equal(await page.locator('.chat-collapse').getAttribute('aria-expanded'), 'false');
      await assertNoOverflow(page, `${language}-${dock}-collapsed`);
      await page.screenshot({ path: `${root}.audit/chat/probe-${language}-${dock}-collapsed.png` });
      await page.locator('.chat-collapse').click();
    }
    await page.setViewportSize({ width: 390, height: 844 });
    assert(await page.locator('.chat-limitation').isVisible());
    assert(await page.locator('#chat-input').isVisible());
    assert(await page.locator('#locale').isVisible());
    await assertNoOverflow(page, `${language}-mobile`);
    await page.screenshot({ path: `${root}.audit/chat/probe-${language}-mobile.png` });
    await page.locator('.chat-collapse').click();
    assert(await page.locator('#locale').isVisible());
    await page.screenshot({ path: `${root}.audit/chat/probe-${language}-mobile-collapsed.png` });
    await page.locator('#locale').selectOption(language === 'en' ? 'zh-CN' : 'en');
    assert.equal(await page.locator('.chat-collapse').getAttribute('aria-expanded'), 'false', 'Mobile language switch does not expand chat');
    await page.locator('#locale').selectOption(language);
    await page.locator('.chat-collapse').click();
    await page.setViewportSize({ width: 1440, height: 1000 });
  }
  const fallbackFont = await page.evaluateHandle(() => {
    const sheet = document.styleSheets[0];
    const index = sheet.insertRule('.chat-panel .chat-collapse { font-family: Verdana, sans-serif; }', sheet.cssRules.length);
    return { sheet, index };
  });
  for (const language of ['en', 'zh-CN']) {
    await page.locator('#locale').selectOption(language);
    for (const dock of ['right', 'left', 'bottom']) {
      await page.locator('.chat-dock').selectOption(dock);
      await page.locator('.chat-collapse').click();
      await assertNoOverflow(page, `fallback-${language}-${dock}-collapsed`);
      assert(await page.locator('.chat-collapse').evaluate(button => button.scrollWidth <= button.clientWidth), 'Expand label must fit without clipping');
      await page.locator('.chat-collapse').click();
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('.chat-collapse').click();
    await assertNoOverflow(page, `fallback-${language}-mobile-collapsed`);
    await page.locator('.chat-collapse').click();
    await page.setViewportSize({ width: 1440, height: 1000 });
  }
  await fallbackFont.evaluate(({ sheet, index }) => sheet.deleteRule(index));
  await fallbackFont.dispose();
  await page.locator('#chat-input').focus();
  await page.evaluate(() => {
    const input = document.querySelector('#chat-input'); input.setSelectionRange(2, 4);
    const select = document.querySelector('#locale'); select.value = 'en'; select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  assert.deepEqual(await page.locator('#chat-input').evaluate(input => [input === window.composerProof, input === document.activeElement, input.selectionStart, input.selectionEnd, input.value]), [true, true, 2, 4, '保留输入 draft']);
  assert.equal(browserCommands, 0, 'Language and layout changes send no Pi commands');
  assert.deepEqual(await (await fetch(path, { headers })).json(), view, 'Locale switch leaves the chat projection unchanged');
  assert.deepEqual(await (await fetch(`${origin}/api/boards/preview`)).json(), originalBoard, 'Locale switch never edits boards');
  assert.deepEqual(await pi.command('get_messages'), originalMessages, 'Locale switch never edits Pi history');
  await page.reload(); await page.waitForFunction(() => document.querySelector('.chat-panel')?.dataset.phase === 'idle');
  assert.equal(await page.locator('html').getAttribute('lang'), 'en', 'Saved choice wins over Chinese navigator on reload');
  await page.locator('#locale').selectOption('zh-CN');
  const toolsNotice = pi.wait(event => event.type === 'extension_ui_request' && event.message?.includes('probeTools'));
  await pi.command('prompt', { message: '/probe-tools' });
  assert.deepEqual(JSON.parse((await toolsNotice).message).probeTools, ['tele_board']);
  const promptEvent = pi.wait(event => event.type === 'extension_ui_request' && event.method === 'confirm');
  const promptCommand = pi.command('prompt', { message: '/probe-prompt' });
  const dialog = await promptEvent;
  assert.equal((await (await fetch(path, { headers })).json()).phase, 'terminal-required');
  await page.waitForFunction(() => document.querySelector('.chat-panel')?.dataset.phase === 'terminal-required');
  assert(await page.getByRole('button', { name: '发送', exact: true }).isDisabled());
  await page.screenshot({ path: `${root}.audit/chat/probe-terminal-required.png` });
  pi.respondUI({ id: dialog.id, confirmed: false });
  await promptCommand;
  assert.equal((await (await fetch(path, { headers })).json()).phase, 'idle');
  await page.locator('#chat-input').fill('Consumed input canary');
  const submission = page.waitForResponse(response => response.url() === `${path}/command` && response.request().method() === 'POST');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  const sent = await submission;
  assert.equal(sent.status(), 202);
  assert.equal((await sent.json()).status, 'submitted');
  await new Promise(resolve => setTimeout(resolve, 8500));
  const unknown = await (await fetch(path, { headers })).json();
  assert.equal(unknown.phase, 'uncertain');
  assert.equal(unknown.submission.state, 'unknown');
  assert.equal(await page.locator('#chat-input').inputValue(), 'Consumed input canary');
  assert(await page.getByRole('button', { name: '发送', exact: true }).isDisabled());
  assert.equal(agentStarts, 0);
  await pi.command('prompt', { message: '/tele off' });
  const restoredNotice = pi.wait(event => event.type === 'extension_ui_request' && event.message?.includes('probeTools'));
  await pi.command('prompt', { message: '/probe-tools' });
  assert.deepEqual(JSON.parse((await restoredNotice).message).probeTools, ['read']);
  assert.equal((await pi.command('get_state')).isStreaming, false);
  const next = new URL(await pi.attach());
  assert(next.hash !== invitation.hash, 'Reattachment renews its invitation');
  assert.equal((await fetch(`${next.origin}/api/chat/${binding}`, { headers })).status, 403, 'Old Origin cannot mutate a replacement service');
  await page.goto(next.href).catch(() => { throw new Error('Probe re-pairing failed'); });
  await page.waitForFunction(() => document.querySelector('.chat-panel')?.dataset.phase === 'idle');
  const suspended = pi.wait(event => event.type === 'extension_ui_request' && event.message === 'Probe input suspended');
  await page.locator('#chat-input').fill('Delayed browser input');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await suspended;
  await pi.command('prompt', { message: '/tele off' });
  const aborted = pi.wait(event => event.type === 'agent_settled');
  await pi.command('prompt', { message: '/probe-release' });
  assert((await aborted).aborted, 'Detached input cannot start an unrestricted late run');
  const lateTools = pi.wait(event => event.type === 'extension_ui_request' && event.message?.includes('probeTools'));
  await pi.command('prompt', { message: '/probe-tools' });
  const late = JSON.parse((await lateTools).message);
  assert.equal(late.providerRequests, 0, 'Revoked async input aborted before any provider request');
  assert.deepEqual(late.probeTools, ['read']);
  const replacement = new URL(await pi.attach());
  await pi.command('new_session');
  await assert.rejects(fetch(`${replacement.origin}/api/capabilities`));
  assert.deepEqual(errors, []);
  const report = { fallbackFontLayout: 'Verdana/sans-serif expand labels stay visible without clipping or page overflow in both languages and all docks, including mobile', internationalization: 'English and Simplified Chinese generated visible/accessibility labels; navigator fallback, invalid preference, blocked storage, persistence; draft node/focus/selection, user notice text, session name, board and original Pi history unchanged; all docks/collapsed/mobile without overflow; zero locale-triggered commands', runtime: 'Pi 1.2.0 in-process extension, RPC used only as preview driver', providerRequests: late.providerRequests, agentStarts, lateSubmission: 'An input suspended by another extension was revoked by off and aborted before provider work', originalPreCompactionHistory: true, privateSummaryExcluded: true, voidSubmissionConsumed: 'unknown after bounded observation', terminalDialog: 'real ui_prompt_start/end observed; driver explicitly declined, browser never approves', toolLoadout: 'bound only, restored after off', lifecycle: 'off keeps Pi alive, new_session stops owned server and revokes grant' };
  await mkdir(`${root}.audit/chat`, { recursive: true });
  await writeFile(`${root}.audit/chat/probe.json`, JSON.stringify(report, null, 2));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally { await browser?.close(); await pi.close(); await rm(directory, { recursive: true, force: true }); }
