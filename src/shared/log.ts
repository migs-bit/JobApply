/**
 * Debug logging for development builds only (`npm run dev`).
 *
 * In production builds `import.meta.env.DEV` is statically false, so these are
 * no-ops: profile values and page data can never reach the console there
 * (Brief.md privacy rules). Use `console.error` directly for failures, and
 * never pass profile values to it.
 *
 * console.log (not console.debug): Chrome hides debug-level messages unless
 * "Verbose" is enabled, which makes scanner output easy to miss.
 */
const PREFIX = '[job-autofill]';

export const debug: (...args: unknown[]) => void = import.meta.env.DEV
  ? (...args) => console.log(PREFIX, ...args)
  : () => {};

export const debugTable: (rows: ReadonlyArray<Record<string, unknown>>) => void = import.meta.env.DEV
  ? (rows) => console.table(rows)
  : () => {};
