import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { z } from 'zod';

export const defaultDataDir = join(homedir(), '.tele');
export const defaultPublicDir = fileURLToPath(new URL('../dist/public/', import.meta.url));
export function configuration(env: NodeJS.ProcessEnv = process.env) {
  return {
    dataDir: resolve(env.TELE_DATA ?? defaultDataDir),
    port: z.coerce.number().int().min(1).max(65535).parse(env.TELE_PORT ?? 4317),
  };
}
