import { base64ToBytes } from '../../shared/resume-validation';
import type { FillInstruction, FillResult, ResumeFile } from '../../shared/types';
import { makeResult, querySafely } from './fill-result';
import { visibleFileTarget } from './visibility';

/**
 * Attaches the stored resume to a file input: builds a File from the stored
 * bytes, puts it in the input through a DataTransfer (the only way a script
 * can set `input.files`), and fires `input` + `change` the way a real file
 * pick does, so React and other frameworks see it.
 *
 * Only ever the resume, only into a field that resolved to `resume`, never
 * over a file the input already holds. The target is re-checked at fill time
 * like every other field.
 */

/** How long to wait after attaching before checking that the page kept the file. */
export const FILE_SETTLE_MS = 100;

/** What each attach put in, keyed by input, so Undo removes only our own file. */
const attached = new WeakMap<HTMLInputElement, { name: string; size: number; lastModified: number }>();

export function isFileInput(el: Element | null): el is HTMLInputElement {
  return el instanceof HTMLInputElement && el.type === 'file';
}

/**
 * Starts attaching. Returns either a final result (nothing attached) or a
 * `settle` function to call after FILE_SETTLE_MS, which checks the file stuck.
 */
export function startFileFill(instruction: FillInstruction, resume: ResumeFile | undefined, doc: Document): FillResult | (() => FillResult) {
  const el = querySafely(doc, instruction.selector);
  const skip = (reason: string) => makeResult(instruction, 'skipped', '', reason);

  if (!isFileInput(el)) return skip('element is not a file input');
  if (instruction.key !== 'resume') return skip('not a resume field');
  if (el.matches(':disabled')) return skip('disabled or read-only');
  // Security: only fill what the user can see (the input, or the upload button wrapped around it).
  if (!visibleFileTarget(el)) return skip('not visible');
  if ((el.files?.length ?? 0) > 0) return skip('already has a file');
  if (!resume || resume.filename !== instruction.value) return skip('no resume uploaded');
  if (!acceptsFile(el.accept, resume.filename, resume.mimeType)) return skip('file type not accepted');

  const bytes = base64ToBytes(resume.base64);
  if (!bytes) return makeResult(instruction, 'failed', '', 'stored resume could not be read');
  const file = new File([bytes], resume.filename, { type: resume.mimeType, lastModified: resume.uploadedAt });

  const transfer = new DataTransfer();
  transfer.items.add(file);
  el.files = transfer.files;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));

  return () => {
    // React can re-render the input away, or a page script can clear it.
    if (!holds(el, file)) return makeResult(instruction, 'failed', '', 'page reverted');
    attached.set(el, { name: file.name, size: file.size, lastModified: file.lastModified });
    return { ...makeResult(instruction, 'filled', ''), attached: file.name };
  };
}

/** Removes the file we attached, if it's still the one there. */
export function undoFile(result: FillResult, doc: Document): boolean {
  const el = querySafely(doc, result.selector);
  const record = isFileInput(el) ? attached.get(el) : undefined;
  if (!isFileInput(el) || !record || !holds(el, record)) return false;
  el.value = ''; // the one value a script may set on a file input: clears its files
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  attached.delete(el);
  return true;
}

/** True if `el` is still on the page and holds exactly this file. A re-render that swaps the input out counts as a revert. */
function holds(el: HTMLInputElement, file: { name: string; size: number; lastModified: number }): boolean {
  const current = el.files?.[0];
  return el.isConnected && el.files?.length === 1 && !!current
    && current.name === file.name && current.size === file.size && current.lastModified === file.lastModified;
}

/**
 * Whether the input's `accept` attribute allows this file. Tokens are
 * extensions (".pdf"), MIME types ("application/pdf") or wildcards
 * ("application/*"); no `accept` means anything goes.
 */
export function acceptsFile(accept: string, filename: string, mimeType: string): boolean {
  const tokens = accept.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
  if (tokens.length === 0) return true;
  const name = filename.toLowerCase();
  return tokens.some((t) =>
    t.startsWith('.') ? name.endsWith(t) : t.endsWith('/*') ? mimeType.startsWith(t.slice(0, -1)) : t === mimeType,
  );
}
