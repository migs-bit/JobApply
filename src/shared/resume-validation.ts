import { LIMITS } from './constants';

/**
 * Rules for the stored resume, shared by the options page (instant feedback)
 * and the service worker (the real check, on the decoded bytes). Pure, so
 * it's unit tested directly.
 */

interface ResumeType {
  extension: string;
  mimeType: string;
  /** The file's first bytes, so a renamed file can't pass as a resume. */
  magic: readonly number[];
}

const PDF: ResumeType = { extension: '.pdf', mimeType: 'application/pdf', magic: [0x25, 0x50, 0x44, 0x46, 0x2d] }; // "%PDF-"
const DOCX: ResumeType = {
  extension: '.docx',
  mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  magic: [0x50, 0x4b, 0x03, 0x04], // a ZIP archive, which is what a .docx is
};
const TYPES: readonly ResumeType[] = [PDF, DOCX];

/** For the file picker's `accept` attribute. */
export const RESUME_ACCEPT = TYPES.flatMap((t) => [t.extension, t.mimeType]).join(',');

export const PDF_MIME = PDF.mimeType;
export const DOCX_MIME = DOCX.mimeType;

/** The MIME type for a resume filename, by extension, or null if it isn't a PDF or DOCX. */
export function resumeMimeType(filename: string): string | null {
  const lower = filename.toLowerCase();
  return TYPES.find((t) => lower.endsWith(t.extension))?.mimeType ?? null;
}

/** Why a file can't be stored as the resume, or null if it can. Checks the name and size only. */
export function resumeFileError(file: { name: string; size: number }): string | null {
  if (!resumeMimeType(file.name)) return 'Only PDF or DOCX files are supported.';
  if (file.size === 0) return 'That file is empty.';
  if (file.size > LIMITS.resumeBytes) {
    return `That file is ${formatBytes(file.size)}. The limit is ${formatBytes(LIMITS.resumeBytes)}.`;
  }
  return null;
}

/** True if the bytes start the way a file of this MIME type must. */
export function contentMatchesType(bytes: Uint8Array, mimeType: string): boolean {
  const type = TYPES.find((t) => t.mimeType === mimeType);
  return !!type && type.magic.every((b, i) => bytes[i] === b);
}

// Control and bidi-override characters: they could disguise a filename ("resume‮fdp.exe").
const UNSAFE_CHARS = /[\u0000-\u001F\u007F-\u009F‪-‮⁦-⁩]/g;

/**
 * A filename safe to store and show: the last path segment only (browsers
 * never give a path, but a crafted message could), no control or bidi
 * characters, length-capped with the extension kept.
 */
export function cleanFilename(name: string): string {
  const base = (name.split(/[\\/]/).pop() ?? '').normalize('NFC').replace(UNSAFE_CHARS, '').trim();
  if (base.length <= LIMITS.resumeFilenameLength) return base;
  const dot = base.lastIndexOf('.');
  const ext = dot > 0 ? base.slice(dot) : '';
  return base.slice(0, LIMITS.resumeFilenameLength - ext.length) + ext;
}

/**
 * Extracted text as stored: control characters out, runs of spaces collapsed,
 * at most one blank line in a row, capped at LIMITS.resumeTextLength.
 */
export function cleanResumeText(text: string): string {
  return text
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F‪-‮⁦-⁩]/g, ' ')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, LIMITS.resumeTextLength);
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// Base64 (chrome.storage holds JSON, so the file is stored as a base64 string)
// ---------------------------------------------------------------------------

const CHUNK = 0x8000;

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(binary);
}

/** Decodes base64, or returns null if it isn't valid base64. */
export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> | null {
  let binary: string;
  try {
    binary = atob(base64);
  } catch {
    return null;
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Longest base64 string a LIMITS.resumeBytes file can produce. */
export const MAX_RESUME_BASE64_LENGTH = Math.ceil(LIMITS.resumeBytes / 3) * 4;
