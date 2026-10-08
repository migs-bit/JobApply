import type * as Mammoth from 'mammoth';
import type * as PdfJs from 'pdfjs-dist';
import { cleanResumeText, DOCX_MIME, PDF_MIME } from '../shared/resume-validation';

/**
 * Plain-text extraction for the uploaded resume, run once at upload, entirely
 * in the extension (no network: the CSP forbids it, and the libraries are told
 * not to fetch). The libraries are passed in so the same code runs under the
 * Node test runner and on the options page (resume-extract.ts).
 *
 * The text is kept for the planned AI tier; nothing reads it yet.
 */

export interface Extractors {
  pdfjs: Pick<typeof PdfJs, 'getDocument'>;
  mammoth: Pick<typeof Mammoth, 'extractRawText'>;
}

/** Gives up on a file that takes longer than this (a huge or hostile PDF): the file is still stored. */
export const EXTRACT_TIMEOUT_MS = 20_000;

/** The resume's text, cleaned and capped; throws if the file can't be read. */
export async function extractResumeText(bytes: Uint8Array<ArrayBuffer>, mimeType: string, libs: Extractors): Promise<string> {
  const raw = await withTimeout(
    mimeType === PDF_MIME ? pdfText(bytes, libs.pdfjs) : mimeType === DOCX_MIME ? docxText(bytes, libs.mammoth) : Promise.reject(new Error('unsupported type')),
    EXTRACT_TIMEOUT_MS,
  );
  return cleanResumeText(raw);
}

async function pdfText(bytes: Uint8Array<ArrayBuffer>, pdfjs: Extractors['pdfjs']): Promise<string> {
  const task = pdfjs.getDocument({
    // A copy: PDF.js transfers the buffer to its worker, which would empty the caller's.
    data: bytes.slice(),
    // Text only: no fonts, no images, nothing fetched. Some PDFs (CJK fonts
    // needing CMap files) may then extract poorly; the file is stored anyway.
    disableFontFace: true,
    useSystemFonts: false,
    useWorkerFetch: false,
    isOffscreenCanvasSupported: false,
    enableXfa: false,
    stopAtErrors: false,
    verbosity: 0,
  });
  try {
    const doc = await task.promise;
    const pages: string[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const content = await (await doc.getPage(n)).getTextContent();
      let page = '';
      for (const item of content.items) {
        if (!('str' in item)) continue;
        page += item.str + (item.hasEOL ? '\n' : ' ');
      }
      pages.push(page);
    }
    return pages.join('\n\n');
  } finally {
    await task.destroy();
  }
}

async function docxText(bytes: Uint8Array<ArrayBuffer>, mammoth: Extractors['mammoth']): Promise<string> {
  const { value } = await mammoth.extractRawText({ arrayBuffer: bytes.slice().buffer });
  return value;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('extraction timed out')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
