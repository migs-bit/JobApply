// Runs both Vite passes (see vite.config.ts). Plain Node, so it works on every OS
// without extra dependencies.
//
//   node scripts/build.mjs               production build into dist/ (debug logging compiled out)
//   node scripts/build.mjs --dev --watch development build with debug logging, rebuilds on change
//   node scripts/build.mjs --out=<dir>   build somewhere else (the E2E tests use temp folders,
//                                        so they never overwrite the dist/ loaded in Chrome)
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dev = process.argv.includes('--dev');
const watch = process.argv.includes('--watch');
const outArg = process.argv.find((a) => a.startsWith('--out='));
const outDir = outArg ? resolve(outArg.slice('--out='.length)) : fileURLToPath(new URL('../dist', import.meta.url));

// Vite derives import.meta.env.DEV from NODE_ENV, not from --mode, so this must
// be set before Vite loads. It's what turns debug() logging on or off.
process.env.NODE_ENV = dev ? 'development' : 'production';
const { build } = await import('vite');

rmSync(outDir, { recursive: true, force: true });

for (const pass of ['main', 'content']) {
  await build({ mode: pass, logLevel: outArg ? 'warn' : 'info', build: { outDir, ...(watch ? { watch: {} } : {}) } });
}
