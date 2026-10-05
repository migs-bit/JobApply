// Shared plumbing for the browser end-to-end suites: a throwaway headless Chrome
// driven over the DevTools protocol (pipe transport), a static server for the
// fixture pages, and helpers for loading the extension and inspecting results.
// No dependencies beyond Node and an installed Chrome.
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const PAGES = join(ROOT, 'test-page');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const tempDir = (prefix) => mkdtempSync(join(tmpdir(), `job-autofill-${prefix}-`));

/** A profile used across suites. Values are obviously fake. */
export const TEST_PROFILE = {
  firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com', phone: '+1 555 010 0100',
  addressLine1: '12 Analytical Engine St', addressLine2: 'Unit 4', city: 'Toronto', state: 'Ontario', postalCode: 'M5V 2T6',
  country: 'Canada', linkedin: 'https://linkedin.com/in/ada', github: 'https://github.com/ada', website: 'https://ada.dev',
};
/** Text values that must never appear in any console output. */
export const SECRET_VALUES = [TEST_PROFILE.email, TEST_PROFILE.phone, TEST_PROFILE.addressLine1, TEST_PROFILE.postalCode, TEST_PROFILE.linkedin];

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export class Suite {
  constructor(name) {
    this.name = name;
    this.results = [];
  }
  check(name, pass, detail = '') {
    this.results.push({ name, pass: !!pass });
    console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${String(detail).slice(0, 300)}` : ''}`);
  }
  get failed() {
    return this.results.filter((r) => !r.pass).length;
  }
}

// ---------------------------------------------------------------------------
// Chrome
// ---------------------------------------------------------------------------

export function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ].filter(Boolean);
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error('Chrome not found. Set CHROME_PATH to a Chrome or Chromium binary.');
  return found;
}

/**
 * Launches headless Chrome with a fresh profile. Extensions are loaded with the
 * DevTools Extensions.loadUnpacked command (branded Chrome ignores --load-extension).
 */
export async function launchChrome() {
  const proc = spawn(
    findChrome(),
    [
      '--headless=new', '--remote-debugging-pipe', '--enable-unsafe-extension-debugging', '--window-size=1280,1600',
      `--user-data-dir=${tempDir('chrome')}`, '--no-first-run', '--no-default-browser-check', 'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] },
  );
  const [toChrome, fromChrome] = [proc.stdio[3], proc.stdio[4]];
  let nextId = 1, buf = '';
  const pending = new Map(), listeners = new Set();
  fromChrome.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\0')) >= 0) {
      const msg = JSON.parse(buf.slice(0, i));
      buf = buf.slice(i + 1);
      if (msg.id && pending.has(msg.id)) { pending.get(msg.id).settle(msg); pending.delete(msg.id); continue; }
      // A target that goes away (e.g. the popup closing itself) never answers its pending calls: fail them now.
      if (msg.method === 'Target.detachedFromTarget') {
        for (const [id, p] of pending) if (p.sessionId === msg.params.sessionId) { p.settle({ error: { message: 'target closed' } }); pending.delete(id); }
      }
      for (const l of listeners) l(msg);
    }
  });
  /** Every call settles: with Chrome's answer, when its target closes, or after 30 s, so no suite can hang. */
  const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      if (pending.delete(id)) rej(new Error(`${method}: no answer within 30s`));
    }, 30_000);
    const settle = (m) => { clearTimeout(timer); m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result); };
    pending.set(id, { settle, sessionId });
    toChrome.write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
  });
  await sleep(800);

  /** Attaches to a target; every console call is captured, in call order, with objects JSON-cloned. */
  async function attach(targetId) {
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const consoleCalls = [], logEntries = [];
    listeners.add(async (m) => {
      if (m.sessionId !== sessionId) return;
      if (m.method === 'Log.entryAdded') logEntries.push(`${m.params.entry.level}: ${m.params.entry.text}`);
      if (m.method !== 'Runtime.consoleAPICalled') return;
      const entry = { type: m.params.type, args: [] };
      consoleCalls.push(entry); // reserve the slot now so order matches the page's call order
      entry.args = await Promise.all(m.params.args.map(async (a) => {
        if (!a.objectId) return a.value;
        const r = await send('Runtime.callFunctionOn', { objectId: a.objectId, functionDeclaration: 'function(){return JSON.stringify(this)}', returnByValue: true }, sessionId).catch(() => null);
        return r?.result?.value === undefined ? null : JSON.parse(r.result.value);
      }));
    });
    for (const domain of ['Runtime', 'Page', 'Log', 'DOM']) await send(`${domain}.enable`, {}, sessionId).catch(() => {});
    const evaluate = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
      return r.exceptionDetails ? { __error: r.exceptionDetails.exception?.description ?? r.exceptionDetails.text } : r.result.value;
    };
    return { targetId, sessionId, evaluate, consoleCalls, logEntries };
  }

  /** Opens a new tab at `url`. */
  async function open(url, waitMs = 1300) {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const page = await attach(targetId);
    await send('Page.navigate', { url }, page.sessionId);
    await sleep(waitMs);
    page.url = url;
    return page;
  }

  async function loadExtension(path) {
    const { id } = await send('Extensions.loadUnpacked', { path });
    await sleep(1000);
    const sw = (await send('Target.getTargets')).targetInfos.find((t) => t.type === 'service_worker' && t.url.includes(id));
    return { id, path, sw: await attach(sw.targetId) };
  }

  /** Same path as the popup: inject content.js into the tab showing `url`, then send FILL_PAGE. */
  async function injectAndFill(ext, url) {
    const r = await send('Runtime.evaluate', {
      awaitPromise: true, returnByValue: true,
      expression: `(async () => {
        const [tab] = (await chrome.tabs.query({})).filter((t) => t.url === ${JSON.stringify(url)});
        if (!tab) return { ok: false, error: 'tab not found' };
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
        return chrome.tabs.sendMessage(tab.id, { type: 'FILL_PAGE' }); })()`,
    }, ext.sw.sessionId);
    await sleep(600);
    return r.result?.value ?? { ok: false, error: r.exceptionDetails?.exception?.description };
  }

  async function saveProfile(ext, profile) {
    const page = await open(`chrome-extension://${ext.id}/options/options.html`, 1200);
    const res = await page.evaluate(`chrome.runtime.sendMessage({ type: 'SET_PROFILE', profile: ${JSON.stringify(profile)} })`);
    await send('Target.closeTarget', { targetId: page.targetId });
    return res;
  }

  return {
    send, attach, open, loadExtension, injectAndFill, saveProfile,
    close: () => proc.kill(),
    targets: async () => (await send('Target.getTargets')).targetInfos,
  };
}

/**
 * Copies a build and grants host access to the given origins. That stands in for
 * the activeTab grant a real popup click gives (headless Chrome can't click the
 * toolbar). The real manifest is never modified.
 */
export function extensionWithHostAccess(dist, origins = ['http://127.0.0.1/*']) {
  const dir = tempDir('ext');
  cpSync(dist, dir, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  manifest.host_permissions = origins;
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest));
  return dir;
}

// ---------------------------------------------------------------------------
// Fixture server
// ---------------------------------------------------------------------------

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

/** Serves test-page/ plus optional in-memory files ({ '/name.html': '<html>…' }). */
export async function serveFixtures(extra = {}) {
  const server = http.createServer((req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    try {
      const body = Object.hasOwn(extra, path) ? extra[path] : readFileSync(join(PAGES, path));
      res.setHeader('content-type', TYPES[extname(path)] ?? 'text/plain');
      res.end(body);
    } catch {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { origin: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}

let visit = 0;
/** A URL that's unique per visit, so a tab lookup by URL can never pick an older tab of the same page. */
export const uniqueUrl = (url) => `${url}${url.includes('?') ? '&' : '?'}visit=${++visit}`;

// ---------------------------------------------------------------------------
// Reading results back
// ---------------------------------------------------------------------------

/** The args of the dev-log table printed right after the debug line starting with `prefix` (e.g. "fill:"). */
export function tableAfter(page, prefix) {
  const calls = page.consoleCalls;
  for (let i = calls.length - 1; i >= 0; i--) {
    if (String(calls[i].args[1]).startsWith(prefix)) return calls[i + 1]?.args[0] ?? [];
  }
  return [];
}
export const debugValue = (page, label) => page.consoleCalls.findLast((c) => c.args[1] === label)?.args[2];

/** Runs `fnDecl` on every node matching `selector` inside the overlay's closed shadow root (CDP can pierce it; pages can't). */
export async function inOverlay(browser, page, selector, fnDecl = 'function(){ return { text: this.textContent, cls: this.className, hidden: this.hidden }; }') {
  const { root } = await browser.send('DOM.getDocument', { depth: -1, pierce: true }, page.sessionId);
  const find = (n) => (n.localName === 'job-autofill-overlay' ? n : (n.children ?? []).map(find).find(Boolean) ?? null);
  const shadow = find(root)?.shadowRoots?.[0];
  if (!shadow) return null;
  const { nodeIds } = await browser.send('DOM.querySelectorAll', { nodeId: shadow.nodeId, selector }, page.sessionId);
  const out = [];
  for (const nodeId of nodeIds) {
    const { object } = await browser.send('DOM.resolveNode', { nodeId }, page.sessionId);
    const r = await browser.send('Runtime.callFunctionOn', { objectId: object.objectId, functionDeclaration: fnDecl, returnByValue: true, awaitPromise: true }, page.sessionId);
    out.push(r.result.value);
  }
  return { shadowRootType: shadow.shadowRootType, results: out };
}
/**
 * A real mouse click (isTrusted) on the index-th node matching `selector` in the
 * overlay. Teach and Undo ignore synthetic clicks, so tests must click like a user.
 */
export async function clickInOverlay(browser, page, selector, index = 0) {
  const found = await inOverlay(browser, page, selector, `function(){ this.scrollIntoView({ block: 'center' });
    const b = this.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; }`);
  const point = found?.results[index];
  if (!point) return false;
  for (const type of ['mousePressed', 'mouseReleased']) {
    await browser.send('Input.dispatchMouseEvent', { type, x: point.x, y: point.y, button: 'left', clickCount: 1 }, page.sessionId);
  }
  await sleep(150);
  return true;
}
/** Rows of the main results list (not the "Not filled" teach list). */
export const RESULT_ROWS = 'section.panel > ul > li';
export const UNDO_BUTTON = 'footer button.action:not(.primary)';

export const overlayPresent = (page) => page.evaluate(`!!document.querySelector('job-autofill-overlay')`);

/** No secret value appears in any captured console output. Returns the leaked values. */
export function leakedValues(pages, secrets = SECRET_VALUES) {
  const all = JSON.stringify(pages.flatMap((p) => [...p.consoleCalls.map((c) => c.args), ...p.logEntries]));
  return secrets.filter((s) => all.includes(s));
}

// ---------------------------------------------------------------------------
// Building small test bundles (React fixture, filler guard bundle)
// ---------------------------------------------------------------------------

/** Bundles `entry` into a single IIFE file and returns its source. React resolves from this repo. */
export async function bundleIife(entry) {
  const out = tempDir('bundle');
  const { build } = await import(join(ROOT, 'node_modules/vite/dist/node/index.js'));
  await build({
    configFile: false, logLevel: 'error',
    define: { 'process.env.NODE_ENV': '"production"' },
    resolve: { alias: { react: join(ROOT, 'node_modules/react'), 'react-dom': join(ROOT, 'node_modules/react-dom') } },
    build: { outDir: out, emptyOutDir: true, minify: false, rollupOptions: { input: entry, output: { format: 'iife', entryFileNames: 'bundle.js' } } },
  });
  return readFileSync(join(out, 'bundle.js'), 'utf8');
}
