/**
 * Debug logging for development builds only (`npm run dev`).
 *
 * In production builds `import.meta.env.DEV` is statically false, so this is
 * a no-op: profile values and page data can never reach the console there
 * (Brief.md privacy rules). Use `console.error` directly for failures, and
 * never pass profile values to it.
 */
export const debug: (...args: unknown[]) => void = import.meta.env.DEV
  ? (...args) => console.debug('[job-autofill]', ...args)
  : () => {};
