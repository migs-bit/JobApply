/**
 * Options-page wiring for resume text extraction. Loaded with a dynamic
 * import only when a file is uploaded, so the PDF and DOCX libraries don't
 * slow down opening the options page.
 *
 * PDF.js runs its parser in a module worker. The worker file is bundled into
 * the extension (Vite's `?url` emits it as an asset), so it loads from the
 * extension's own origin, which the CSP's `script-src 'self'` allows.
 */
import mammoth from 'mammoth';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { extractResumeText } from './resume-text';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export function extractText(bytes: Uint8Array<ArrayBuffer>, mimeType: string): Promise<string> {
  return extractResumeText(bytes, mimeType, { pdfjs, mammoth });
}
