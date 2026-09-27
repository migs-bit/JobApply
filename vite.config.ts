import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * The extension is built in two passes because MV3 content scripts cannot be
 * ES modules, while the service worker and options page can:
 *
 *   `vite build`                → background.js (ES module) + options page
 *   `vite build --mode content` → content.js (single self-contained IIFE)
 *
 * Running them as separate builds guarantees content.js never contains an
 * `import` statement pointing at a shared chunk.
 *
 * Output layout (load `dist/` as an unpacked extension):
 *   dist/manifest.json
 *   dist/background.js
 *   dist/content.js
 *   dist/options/options.html
 *   dist/chunks/*, dist/assets/*
 */

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/** Copies the root manifest.json into dist/ and rebuilds when it changes. */
function copyManifest(): Plugin {
  const manifestPath = r('./manifest.json');
  return {
    name: 'copy-manifest',
    buildStart() {
      this.addWatchFile(manifestPath);
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'manifest.json',
        source: readFileSync(manifestPath, 'utf-8'),
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const shared = {
    root: r('./src'),
    publicDir: false as const,
    build: {
      outDir: r('./dist'),
      // `npm run clean` empties dist once; both passes write into it.
      emptyOutDir: false,
      sourcemap: true,
      minify: false,
    },
  };

  if (mode === 'content') {
    return {
      ...shared,
      build: {
        ...shared.build,
        rollupOptions: {
          input: { content: r('./src/content/content-script.ts') },
          output: {
            format: 'iife' as const,
            entryFileNames: 'content.js',
          },
        },
      },
    };
  }

  return {
    ...shared,
    plugins: [react(), copyManifest()],
    base: '/',
    build: {
      ...shared.build,
      modulePreload: { polyfill: false },
      rollupOptions: {
        input: {
          background: r('./src/background/service-worker.ts'),
          options: r('./src/options/options.html'),
        },
        output: {
          entryFileNames: '[name].js',
          chunkFileNames: 'chunks/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash][extname]',
        },
      },
    },
  };
});
