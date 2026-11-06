import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

export default function probe(pi: ExtensionAPI) {
  let release: (() => void) | undefined;
  let providerRequests = 0;
  pi.registerProvider('tele-probe', {
    baseUrl: 'https://tele-probe.invalid', apiKey: 'tele-probe-no-network', api: 'tele-probe',
    models: [{ id: 'no-network', name: 'No-network probe', reasoning: false, input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 1024 }],
    streamSimple() { providerRequests++; throw new Error('Probe must abort before provider execution'); },
  });
  pi.on('before_provider_request', (_event, ctx) => { providerRequests++; ctx.abort(); });
  pi.on('input', async (event, ctx) => {
    if (event.source !== 'extension') return;
    if (event.text !== 'Delayed browser input') return { action: 'handled' };
    await new Promise<void>(resolve => { release = resolve; ctx.ui.notify('Probe input suspended', 'info'); });
    return { action: 'continue' };
  });
  pi.registerCommand('probe-release', {
    description: 'Release only the suspended disposable probe input',
    handler: async () => { release?.(); release = undefined; },
  });
  pi.registerCommand('probe-seed', {
    description: 'Seed only this disposable no-model probe',
    handler: async (_args, ctx) => {
      await ctx.newSession({ setup: async manager => {
        manager.appendMessage({ role: 'user', content: 'Old canary: cobalt cadence.', timestamp: 1 });
        const kept = manager.appendMessage({ role: 'user', content: 'Pi 已压缩模型上下文。这里仍显示当前分支的原始对话。', timestamp: 2 });
        manager.appendMessage({ role: 'toolResult', toolCallId: 'probe-tool', toolName: 'tele_board', content: [{ type: 'text', text: 'Private raw tool payload' }], isError: false, timestamp: 3 });
        manager.appendSessionInfo('用户 session name');
        manager.appendCompaction('Private summary must not be projected', kept, 12000);
      } });
    },
  });
  pi.registerCommand('probe-prompt', {
    description: 'Expose a real Pi UI prompt without model work',
    handler: async (_args, ctx) => { await ctx.ui.confirm('Probe terminal action', 'Explicitly decline in the test driver.'); },
  });
  pi.registerCommand('probe-tools', {
    description: 'Observe tool declarations without a model',
    handler: async (_args, ctx) => { ctx.ui.notify(JSON.stringify({ probeTools: pi.getActiveTools(), providerRequests }), 'info'); },
  });
}
