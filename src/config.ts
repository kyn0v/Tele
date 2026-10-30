import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { z } from 'zod';

export const defaultDataDir = fileURLToPath(new URL('../.data/', import.meta.url));
export const defaultPublicDir = fileURLToPath(new URL('../dist/public/', import.meta.url));
export function configuration(env: NodeJS.ProcessEnv = process.env) {
  return {
    dataDir: resolve(env.AUDIOHARNESS_DATA ?? defaultDataDir),
    port: z.coerce.number().int().min(1).max(65535).parse(env.AUDIOHARNESS_PORT ?? 4317),
  };
}
