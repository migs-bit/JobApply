// Browser end-to-end suites. Builds the extension (dev + production) into temp
// folders, so your dist/ is never touched, then runs each suite in its own
// throwaway headless Chrome.
//
//   npm run test:e2e                       all offline suites (fixture pages only)
//   npm run test:e2e -- fill overlay       just these suites
//   npm run test:e2e -- --live             also hit live Lever/Ashby/Replit postings (needs network)
//
// Requires Chrome (set CHROME_PATH if it isn't in a standard location).
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { ROOT, tempDir } from './lib/harness.mjs';

const SUITES = ['extension', 'scanner', 'resolve', 'fill', 'popup', 'overlay', 'profile-keys', 'radio'];
const args = process.argv.slice(2);
const live = args.includes('--live');
const picked = args.filter((a) => !a.startsWith('--'));
const unknown = picked.filter((s) => !SUITES.includes(s));
if (unknown.length) {
  console.error(`Unknown suite(s): ${unknown.join(', ')}. Available: ${SUITES.join(', ')}`);
  process.exit(2);
}

const out = tempDir('builds');
const devDist = join(out, 'dev');
const prodDist = join(out, 'prod');
for (const [dir, flags] of [[devDist, ['--dev']], [prodDist, []]]) {
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts/build.mjs'), `--out=${dir}`, ...flags], { stdio: 'inherit', cwd: ROOT });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

let total = 0, failed = 0;
for (const name of picked.length ? picked : SUITES) {
  console.log(`\n▶ ${name}`);
  const { run } = await import(`./${name}.mjs`);
  try {
    const suite = await run({ devDist, prodDist, live });
    total += suite.results.length;
    failed += suite.failed;
  } catch (err) {
    console.error(`  HARNESS ERROR in ${name}:`, err);
    total++;
    failed++;
  }
}
console.log(`\n${total - failed}/${total} checks passed${live ? ' (including live sites)' : ''}`);
process.exit(failed ? 1 : 0);
