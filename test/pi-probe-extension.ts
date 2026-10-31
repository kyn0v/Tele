import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

export default function probe(pi: ExtensionAPI) {
  pi.on('input', event => { if (event.source === 'extension') return { action: 'handled' }; });
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
    handler: async (_args, ctx) => { ctx.ui.notify(JSON.stringify({ probeTools: pi.getActiveTools() }), 'info'); },
  });
}
