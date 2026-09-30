// Runs tests/*.test.ts with Node's built-in test runner (no test framework
// dependency). Vite bundles each test file so the sources' extensionless
// imports resolve the same way they do in the extension build.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const outDir = `${root}node_modules/.tmp/tests`;
const entries = Object.fromEntries(
  readdirSync(`${root}tests`)
    .filter((f) => f.endsWith('.test.ts'))
    .map((f) => [f.replace(/\.ts$/, ''), `${root}tests/${f}`]),
);

const { build } = await import('vite');
await build({
  configFile: false,
  logLevel: 'warn',
  build: {
    ssr: true,
    outDir,
    emptyOutDir: true,
    minify: false,
    rollupOptions: { input: entries, output: { format: 'es', entryFileNames: '[name].mjs' } },
  },
});

const files = Object.keys(entries).map((name) => `${outDir}/${name}.mjs`);
const { status } = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(status ?? 1);
