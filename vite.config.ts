import { defineConfig, type Plugin, type UserConfig } from 'vite';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Two build passes, because MV3 content scripts can't be ES modules while the
 * service worker and extension pages can:
 *
 *   `vite build`                → background.js (ES module) + extension pages
 *   `vite build --mode content` → content.js as one self-contained IIFE
 *
 * The content pass is wired into package.json once the content script exists
 * (build step 5). Load `dist/` as an unpacked extension.
 *
 * No React plugin: Vite transforms JSX natively, and we never use the dev
 * server, so Fast Refresh (the plugin's main job) isn't needed.
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
      this.emitFile({ type: 'asset', fileName: 'manifest.json', source: readFileSync(manifestPath, 'utf-8') });
    },
  };
}

/** Extension pages; later build steps add popup.html here. */
const PAGES = {
  options: r('./src/options/options.html'),
  popup: r('./src/popup/popup.html'),
};

export default defineConfig(({ mode }): UserConfig => {
  const shared: UserConfig = {
    root: r('./src'),
    // Placeholder icons live in public/ and are copied to dist/ as-is.
    publicDir: mode === 'content' ? false : r('./public'),
    build: {
      outDir: r('./dist'),
      // `npm run clean` empties dist once; both passes write into it.
      emptyOutDir: false,
      target: 'chrome120',
      sourcemap: true,
      // Unminified output keeps the shipped code reviewable (open source, and
      // the Chrome Web Store reviews readable code faster).
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
          output: { format: 'iife', entryFileNames: 'content.js' },
        },
      },
    };
  }

  const pages = Object.fromEntries(Object.entries(PAGES).filter(([, path]) => existsSync(path)));

  return {
    ...shared,
    plugins: [copyManifest()],
    build: {
      ...shared.build,
      // The polyfill would inject an inline script, which our CSP forbids.
      modulePreload: { polyfill: false },
      rollupOptions: {
        input: { background: r('./src/background/service-worker.ts'), ...pages },
        output: {
          entryFileNames: '[name].js',
          chunkFileNames: 'chunks/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash][extname]',
        },
      },
    },
  };
});
