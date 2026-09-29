// Runs both Vite passes (see vite.config.ts). Plain Node, so it works on every OS
// without extra dependencies.
//
//   node scripts/build.mjs               production build (debug logging compiled out)
//   node scripts/build.mjs --dev --watch development build with debug logging, rebuilds on change
import { rmSync } from 'node:fs';

const dev = process.argv.includes('--dev');
const watch = process.argv.includes('--watch');

// Vite derives import.meta.env.DEV from NODE_ENV, not from --mode, so this must
// be set before Vite loads. It's what turns debug() logging on or off.
process.env.NODE_ENV = dev ? 'development' : 'production';
const { build } = await import('vite');

rmSync(new URL('../dist', import.meta.url), { recursive: true, force: true });

for (const pass of ['main', 'content']) {
  await build({ mode: pass, ...(watch ? { build: { watch: {} } } : {}) });
}
