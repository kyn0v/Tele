import { build } from 'esbuild';
import { copyFile, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
await rm(new URL('../dist/', import.meta.url), { recursive: true, force: true });
await mkdir(new URL('../dist/public/assets/', import.meta.url), { recursive: true });
await Promise.all([
  build({ absWorkingDir: root, entryPoints: ['src/main.ts', 'src/cli.ts'], outdir: 'dist', bundle: true, platform: 'node', format: 'esm', packages: 'external', target: 'node22' }),
  build({ absWorkingDir: root, entryPoints: ['src/web.ts', 'src/audio.ts'], outdir: 'dist/public/assets', bundle: true, format: 'esm', target: 'es2022', minify: true }),
  copyFile(new URL('../src/index.html', import.meta.url), new URL('../dist/public/index.html', import.meta.url)),
  copyFile(new URL('../src/favicon.svg', import.meta.url), new URL('../dist/public/favicon.svg', import.meta.url)),
  copyFile(new URL('../src/style.css', import.meta.url), new URL('../dist/public/assets/style.css', import.meta.url)),
]);
