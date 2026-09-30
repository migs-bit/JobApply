/**
 * Overlay styles, applied inside a closed shadow root via a constructable
 * stylesheet (adoptedStyleSheets), so page CSS can't reach in and the page's
 * CSP `style-src` rules don't block it the way an injected <style> could be.
 */
export const OVERLAY_CSS = `
:host { all: initial; }

.panel {
  --bg: #ffffff; --text: #111827; --muted: #6b7280; --border: #e5e7eb; --hover: #f9fafb;
  --accent: #2563eb; --accent-text: #ffffff; --error: #b91c1c;
  --review-bg: #fef3c7; --review-border: #f59e0b; --review-text: #92400e;
  position: fixed; top: 16px; right: 16px; z-index: 2147483647;
  width: 360px; max-width: calc(100vw - 32px); max-height: min(70vh, 520px);
  display: flex; flex-direction: column; box-sizing: border-box;
  font: 13px/1.45 system-ui, -apple-system, 'Segoe UI', sans-serif; color: var(--text);
  background: var(--bg); border: 1px solid var(--border); border-radius: 10px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.18); overflow: hidden; text-align: left;
}
@media (prefers-color-scheme: dark) {
  .panel {
    --bg: #111827; --text: #f3f4f6; --muted: #9ca3af; --border: #374151; --hover: #1f2937;
    --accent: #60a5fa; --accent-text: #0b0f17; --error: #f87171;
    --review-bg: #3b2f0b; --review-border: #fbbf24; --review-text: #fde68a;
  }
}

header { padding: 12px 14px 10px; border-bottom: 1px solid var(--border); }
h2 { margin: 0; font-size: 14px; font-weight: 600; }
.summary { margin: 2px 0 0; color: var(--muted); }

ul { list-style: none; margin: 0; padding: 4px 0; overflow-y: auto; }
li + li { border-top: 1px solid var(--border); }

.row {
  all: unset; box-sizing: border-box; display: grid; grid-template-columns: 1fr auto; gap: 1px 10px;
  width: 100%; padding: 8px 14px; cursor: pointer;
}
.row:hover { background: var(--hover); }
.row:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.review .row { background: var(--review-bg); box-shadow: inset 3px 0 0 var(--review-border); }
.label { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.value { grid-column: 1 / -1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.meta { grid-column: 1 / -1; color: var(--muted); font-size: 12px; }
.badge {
  align-self: start; padding: 0 7px; border-radius: 999px; font-size: 11px; font-weight: 600;
  border: 1px solid var(--border); color: var(--muted);
}
.review .badge { border-color: var(--review-border); color: var(--review-text); }
.failed .badge, .failed .meta { color: var(--error); border-color: var(--error); }
.undone { opacity: 0.55; }

footer { display: flex; gap: 8px; justify-content: flex-end; padding: 10px 14px; border-top: 1px solid var(--border); }
button.action {
  all: unset; box-sizing: border-box; padding: 6px 14px; border-radius: 6px; font-weight: 600; cursor: pointer;
  border: 1px solid var(--border); color: var(--text);
}
button.action.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-text); }
button.action:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
button.action[hidden] { display: none; }
`;

/** Outline for low-confidence fields on the page itself, so they're easy to find. */
export const REVIEW_OUTLINE = { outline: '2px solid #f59e0b', outlineOffset: '1px' } as const;
