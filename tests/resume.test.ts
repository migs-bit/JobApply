import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import mammoth from 'mammoth';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { buildFillPlan } from '../src/background/fill-plan';
import { resolveField } from '../src/background/resolver/field-resolver';
import { EMPTY_LEARNED, learnAnswer } from '../src/background/storage/learned-store';
import {
  buildResume, deleteResume, getResume, resumeFileOf, sanitizeResume, saveResume, summarize, type StoredResume,
} from '../src/background/storage/resume-store';
import { acceptsFile } from '../src/content/filler/file-filler';
import { extractResumeText } from '../src/options/resume-text';
import { fillStatus } from '../src/popup/status';
import { EMPTY_PROFILE, LIMITS, STORAGE_KEYS } from '../src/shared/constants';
import {
  bytesToBase64, cleanFilename, cleanResumeText, DOCX_MIME, PDF_MIME, resumeFileError, wordCount,
} from '../src/shared/resume-validation';
import type { FieldCandidate, FillSummary } from '../src/shared/types';

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../../../tests/fixtures/${name}`, import.meta.url)));
const PDF_BYTES = fixture('dummy-resume.pdf');
const DOCX_BYTES = fixture('dummy-resume.docx');

let n = 0;
function field(overrides: Partial<FieldCandidate>): FieldCandidate {
  n++;
  return {
    id: `f_${n}`, selector: `#f${n}`, tag: 'input', type: 'file', name: '', autocomplete: '',
    label: '', placeholder: '', ariaLabel: '', nearbyText: '', ...overrides,
  };
}
const keyOf = (f: Partial<FieldCandidate>) => resolveField(field(f), EMPTY_PROFILE).key;

/** A file of `size` bytes that starts like a real PDF. */
function pdfOfSize(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set(PDF_BYTES.subarray(0, 8));
  return bytes;
}
const upload = (filename: string, bytes: Uint8Array, extractedText = 'Ada Lovelace') =>
  buildResume({ filename, base64: bytesToBase64(bytes), extractedText }, 1_700_000_000_000);

describe('dictionary: the resume key', () => {
  it('matches resume wordings on file inputs', () => {
    for (const label of ['Resume', 'CV', 'Curriculum vitae', 'Attach resume', 'Upload resume', 'Upload CV', 'Resume/CV ✱', 'Résumé', 'Resume (PDF)']) {
      assert.equal(keyOf({ label }), 'resume', label);
    }
    assert.equal(keyOf({ name: 'resume' }), 'resume');
    assert.equal(keyOf({ nearbyText: 'Please attach your most recent resume in PDF or Word format' }), 'resume');
  });
  it('never matches other documents', () => {
    for (const label of ['Cover letter', 'Portfolio', 'Writing sample', 'Transcript', 'Resume and cover letter', 'Upload your transcript', 'Resume or portfolio']) {
      assert.equal(keyOf({ label }), 'unknown', label);
    }
  });
  it('records evidence for the match', () => {
    assert.match(resolveField(field({ label: 'Resume' }), EMPTY_PROFILE).evidence, /^label "Resume" matched/);
  });
});

describe('file input detection', () => {
  it('only type="file" fields can resolve to resume', () => {
    assert.equal(keyOf({ type: 'text', label: 'Resume' }), 'unknown');
    assert.equal(keyOf({ tag: 'textarea', type: '', label: 'Paste your resume' }), 'unknown');
    assert.equal(keyOf({ tag: 'select', type: '', label: 'Resume' }), 'unknown');
  });
  it('a file input resolves to resume or nothing: never a profile key', () => {
    assert.equal(keyOf({ label: 'Email' }), 'unknown');
    assert.equal(keyOf({ label: 'LinkedIn' }), 'unknown');
    assert.equal(keyOf({ autocomplete: 'email', label: 'Upload' }), 'unknown');
    assert.match(resolveField(field({ label: 'Photo' }), EMPTY_PROFILE).evidence, /not a resume field/);
  });
  it('a learned text answer never applies to a file input', () => {
    const learned = learnAnswer(EMPTY_LEARNED, 'Cover letter', 'Dear hiring manager', 'text');
    assert.ok(learned.ok);
    if (!learned.ok) return;
    assert.equal(resolveField(field({ type: 'text', label: 'Cover letter' }), EMPTY_PROFILE, learned.store).key, 'learned');
    const onFile = resolveField(field({ label: 'Cover letter' }), EMPTY_PROFILE, learned.store);
    assert.deepEqual([onFile.key, onFile.evidence], ['unknown', 'file inputs only take your resume']);
  });
});

describe('fill plan with a resume', () => {
  const stored = upload('ada-resume.pdf', PDF_BYTES);
  assert.ok(stored.ok);
  const file = stored.ok ? resumeFileOf(stored.resume) : null;
  const fields = [field({ label: 'Resume' }), field({ label: 'Cover letter' }), field({ type: 'text', label: 'Resume' })];

  it('resume fields get an always-reviewed instruction; the file rides once on the plan', () => {
    const plan = buildFillPlan([...fields, field({ label: 'CV' })], EMPTY_PROFILE, EMPTY_LEARNED, file);
    assert.deepEqual(plan.instructions.map((i) => [i.key, i.value, i.requiresReview]), [['resume', 'ada-resume.pdf', true], ['resume', 'ada-resume.pdf', true]]);
    assert.equal(plan.resume?.filename, 'ada-resume.pdf');
    assert.equal(plan.resume?.base64, stored.ok ? stored.resume.base64 : '');
    assert.ok(!('extractedText' in (plan.resume ?? {})), 'extracted text never goes to the page');
  });
  it('without a resume, the field still gets an instruction (so it reports "no resume uploaded")', () => {
    const plan = buildFillPlan(fields, EMPTY_PROFILE, EMPTY_LEARNED, null);
    assert.deepEqual(plan.instructions.map((i) => [i.key, i.value]), [['resume', '']]);
    assert.equal(plan.resume, undefined);
  });
  it('a page with no resume field never receives the file', () => {
    const plan = buildFillPlan([field({ label: 'Cover letter' }), field({ type: 'text', label: 'Resume' })], EMPTY_PROFILE, EMPTY_LEARNED, file);
    assert.equal(plan.instructions.length, 0);
    assert.equal(plan.resume, undefined);
  });
});

describe('resume validation', () => {
  it('size limit: rejects 6 MB, accepts 500 KB', () => {
    assert.match(resumeFileError({ name: 'big.pdf', size: 6 * 1024 * 1024 }) ?? '', /6\.0 MB\. The limit is 5\.0 MB/);
    assert.equal(resumeFileError({ name: 'ok.pdf', size: 500 * 1024 }), null);
    const big = upload('big.pdf', pdfOfSize(6 * 1024 * 1024));
    assert.ok(!big.ok && /limit is 5/.test(big.error), 'the service worker re-checks the decoded size');
    assert.ok(upload('ok.pdf', pdfOfSize(500 * 1024)).ok);
  });
  it('type limit: rejects .txt, .png, .zip', () => {
    for (const name of ['resume.txt', 'resume.png', 'resume.zip', 'resume.doc', 'resume']) {
      assert.equal(resumeFileError({ name, size: 1000 }), 'Only PDF or DOCX files are supported.', name);
    }
    assert.equal(resumeFileError({ name: 'Resume.PDF', size: 1000 }), null);
    assert.equal(resumeFileError({ name: 'resume.docx', size: 1000 }), null);
  });
  it('rejects a file whose content doesn’t match its extension', () => {
    const png = upload('resume.pdf', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    assert.ok(!png.ok && /valid PDF/.test(png.error));
    const pdfAsDocx = upload('resume.docx', PDF_BYTES);
    assert.ok(!pdfAsDocx.ok && /valid DOCX/.test(pdfAsDocx.error));
    assert.ok(upload('resume.docx', DOCX_BYTES).ok);
  });
  it('the MIME type comes from the extension, never the sender', () => {
    const r = upload('cv.docx', DOCX_BYTES);
    assert.ok(r.ok && r.resume.mimeType === DOCX_MIME);
  });
  it('filenames: last path segment only, no control or bidi characters, length-capped keeping the extension', () => {
    assert.equal(cleanFilename('C:\\Users\\ada\\resume.pdf'), 'resume.pdf');
    assert.equal(cleanFilename('/home/ada/resume.pdf'), 'resume.pdf');
    assert.equal(cleanFilename('resume\u202Efdp.exe.pdf'), 'resumefdp.exe.pdf');
    const long = cleanFilename(`${'a'.repeat(500)}.pdf`);
    assert.ok(long.length === LIMITS.resumeFilenameLength && long.endsWith('.pdf'));
  });
  it('extracted text is cleaned and capped at 20,000 characters', () => {
    assert.equal(cleanResumeText('  Ada \t Lovelace \r\n\n\n\nMathematician\u0007 '), 'Ada Lovelace\n\nMathematician');
    const capped = upload('r.pdf', PDF_BYTES, 'word '.repeat(10_000));
    assert.ok(capped.ok && capped.resume.extractedText.length === LIMITS.resumeTextLength);
    assert.equal(wordCount('Ada Lovelace\n\nMathematician'), 3);
  });
});

describe('resume storage', () => {
  it('round-trips save and load through chrome.storage.local', async () => {
    const area: Record<string, unknown> = {};
    const g = globalThis as unknown as { chrome?: unknown };
    const previous = g.chrome;
    g.chrome = {
      storage: {
        local: {
          get: async (key: string) => (Object.hasOwn(area, key) ? { [key]: structuredClone(area[key]) } : {}),
          set: async (items: Record<string, unknown>) => Object.assign(area, structuredClone(items)),
          remove: async (key: string) => void delete area[key],
        },
      },
    };
    try {
      const built = upload('ada-resume.pdf', PDF_BYTES);
      assert.ok(built.ok);
      if (!built.ok) return;
      assert.equal(await getResume(), null);
      await saveResume(built.resume);
      assert.ok(Object.hasOwn(area, STORAGE_KEYS.resume));
      const loaded = await getResume();
      assert.deepEqual(loaded, built.resume);
      assert.deepEqual(summarize(loaded as StoredResume), {
        filename: 'ada-resume.pdf', mimeType: PDF_MIME, size: PDF_BYTES.length, uploadedAt: 1_700_000_000_000, wordCount: 2,
      });
      await deleteResume();
      assert.equal(await getResume(), null);
    } finally {
      g.chrome = previous;
    }
  });
  it('tampered or old stored data loads as "no resume", never throws', () => {
    for (const raw of [null, 'x', {}, { filename: 'r.pdf', base64: '!!', uploadedAt: 1 }, { filename: 'r.txt', base64: bytesToBase64(PDF_BYTES), uploadedAt: 1 }]) {
      assert.equal(sanitizeResume(raw), null, JSON.stringify(raw));
    }
  });
});

describe('text extraction', () => {
  // Mammoth's Node build reads a Buffer; its browser build (the one the extension bundles) reads an ArrayBuffer.
  const nodeMammoth = {
    extractRawText: (input: { arrayBuffer: ArrayBuffer }) => mammoth.extractRawText({ buffer: Buffer.from(input.arrayBuffer) }),
  } as unknown as Pick<typeof mammoth, 'extractRawText'>;
  const libs = { pdfjs, mammoth: nodeMammoth };
  it('PDF fixture produces its text', async () => {
    const text = await extractResumeText(PDF_BYTES.slice(), PDF_MIME, libs);
    assert.match(text, /Ada Lovelace - DUMMY TEST RESUME/);
    assert.match(text, /Analytical Engine/);
  });
  it('DOCX fixture produces its text', async () => {
    const text = await extractResumeText(DOCX_BYTES.slice(), DOCX_MIME, libs);
    assert.match(text, /Ada Lovelace - DUMMY TEST RESUME/);
    assert.match(text, /Analytical Engine/);
  });
  it('a corrupt file rejects (the options page then stores the file without text)', async () => {
    await assert.rejects(extractResumeText(pdfOfSize(2000).slice(), PDF_MIME, libs));
    await assert.rejects(extractResumeText(new Uint8Array([0x50, 0x4b, 3, 4, 0, 0]), DOCX_MIME, libs));
  });
});

describe('file input accept attribute', () => {
  it('extensions, MIME types and wildcards', () => {
    assert.ok(acceptsFile('', 'r.pdf', PDF_MIME));
    assert.ok(acceptsFile('.pdf,.doc,.docx', 'R.PDF', PDF_MIME));
    assert.ok(acceptsFile('application/pdf', 'r.pdf', PDF_MIME));
    assert.ok(acceptsFile('application/*', 'r.docx', DOCX_MIME));
    assert.ok(!acceptsFile('image/*', 'r.pdf', PDF_MIME));
    assert.ok(!acceptsFile('.doc,.docx', 'r.pdf', PDF_MIME));
  });
});

describe('popup status with a resume', () => {
  const summary = (s: Partial<FillSummary>): FillSummary => ({
    fields: 10, matched: 7, attempted: 7, filled: 6, needsReview: 0, failed: 0, teachable: 0, overlayShown: false,
    resumeAttached: false, resumeMissing: false, ...s,
  });
  it('mentions an attached resume', () => {
    assert.equal(fillStatus(summary({ resumeAttached: true })), 'Filled 6 of 7 fields · resume attached.');
  });
  it('says when the page wants a resume and none is uploaded', () => {
    assert.equal(fillStatus(summary({ resumeMissing: true })), 'Filled 6 of 7 fields · no resume uploaded.');
    assert.equal(fillStatus(summary({ matched: 1, attempted: 0, filled: 0, resumeMissing: true })), 'This page asks for a resume, but none is uploaded. Add one in Options.');
  });
});
