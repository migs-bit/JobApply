import { STORAGE_KEYS } from '../../shared/constants';
import {
  base64ToBytes, cleanFilename, cleanResumeText, contentMatchesType, resumeFileError, resumeMimeType, wordCount,
} from '../../shared/resume-validation';
import type { ResumeFile, ResumeSummary } from '../../shared/types';

/**
 * The user's resume: one file, stored in chrome.storage.local alongside the
 * profile (same TRUSTED_CONTEXTS access level, so content scripts can't read
 * it). A 5 MB file is ~6.7 MB as base64, inside storage.local's 10 MB quota,
 * so no IndexedDB is needed.
 *
 * No site or URL is stored with it. `extractedText` is kept for the planned
 * AI tier (opt-in, the user's own key); nothing reads it yet.
 *
 * Pure functions apart from getResume / saveResume / deleteResume.
 */

export interface StoredResume {
  filename: string;
  mimeType: string;
  /** Bytes of the decoded file. */
  size: number;
  base64: string;
  /** Plain text extracted at upload; '' if extraction failed or found none. */
  extractedText: string;
  uploadedAt: number;
}

export type ResumeResult = { ok: true; resume: StoredResume } | { ok: false; error: string };

/**
 * Builds a StoredResume from an upload, checking the *decoded bytes*: the
 * size limit, and that the content really is a PDF/DOCX matching its
 * extension. The MIME type comes from the extension, never from the sender.
 */
export function buildResume(input: { filename: string; base64: string; extractedText: string }, now = Date.now()): ResumeResult {
  const filename = cleanFilename(input.filename);
  const mimeType = resumeMimeType(filename);
  if (!filename || !mimeType) return { ok: false, error: 'Only PDF or DOCX files are supported.' };

  const bytes = base64ToBytes(input.base64);
  if (!bytes) return { ok: false, error: 'The file could not be read.' };
  const sizeError = resumeFileError({ name: filename, size: bytes.length });
  if (sizeError) return { ok: false, error: sizeError };
  if (!contentMatchesType(bytes, mimeType)) {
    return { ok: false, error: `That file isn't a valid ${mimeType === 'application/pdf' ? 'PDF' : 'DOCX'} file.` };
  }

  return {
    ok: true,
    resume: { filename, mimeType, size: bytes.length, base64: input.base64, extractedText: cleanResumeText(input.extractedText), uploadedAt: now },
  };
}

/** Coerces stored data (possibly old or tampered with) into a StoredResume, or null. Never throws. */
export function sanitizeResume(raw: unknown): StoredResume | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.filename !== 'string' || typeof r.base64 !== 'string' || typeof r.uploadedAt !== 'number') return null;
  const built = buildResume(
    { filename: r.filename, base64: r.base64, extractedText: typeof r.extractedText === 'string' ? r.extractedText : '' },
    r.uploadedAt,
  );
  return built.ok ? built.resume : null;
}

export function summarize(resume: StoredResume): ResumeSummary {
  const { filename, mimeType, size, uploadedAt, extractedText } = resume;
  return { filename, mimeType, size, uploadedAt, wordCount: wordCount(extractedText) };
}

/** The part a content script needs to attach the file: no extracted text. */
export function resumeFileOf(resume: StoredResume): ResumeFile {
  const { filename, mimeType, base64, uploadedAt } = resume;
  return { filename, mimeType, base64, uploadedAt };
}

export async function getResume(): Promise<StoredResume | null> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.resume);
  return sanitizeResume(stored[STORAGE_KEYS.resume]);
}

export async function saveResume(resume: StoredResume): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.resume]: resume });
}

export async function deleteResume(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEYS.resume);
}
