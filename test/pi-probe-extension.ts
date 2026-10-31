import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

export default function probe(pi: ExtensionAPI) {
  let release: (() => void) | undefined;
  let providerRequests = 0;
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
        const kept = manager.appendMessage({ role: 'user', content: 'Recent music question.', timestamp: 2 });
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
