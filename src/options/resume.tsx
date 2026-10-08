/**
 * Options page: upload, replace and remove the resume. The file is read and
 * its text extracted here (once, at upload), then sent to the service worker,
 * which re-checks the bytes and stores it. The page only ever gets a summary
 * back (name, size, date, word count), never the stored file or text.
 */
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { sendToBackground } from '../shared/messaging';
import { bytesToBase64, formatBytes, RESUME_ACCEPT, resumeFileError, resumeMimeType } from '../shared/resume-validation';
import type { ResumeSummary } from '../shared/types';

type Status = { kind: 'idle' | 'working'; message?: string } | { kind: 'error' | 'warning' | 'done'; message: string };

export function ResumeSection() {
  const [resume, setResume] = useState<ResumeSummary | null>(null);
  const [status, setStatus] = useState<Status>({ kind: 'working', message: 'Loading…' });
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void sendToBackground<ResumeSummary | null>({ type: 'GET_RESUME' }).then((res) => {
      if (res.ok) setResume(res.data);
      setStatus(res.ok ? { kind: 'idle' } : { kind: 'error', message: 'Could not load your resume.' });
    });
  }, []);

  const onPick = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // picking the same file again should still trigger a change
    if (!file) return;
    const invalid = resumeFileError(file);
    const mimeType = resumeMimeType(file.name);
    if (invalid || !mimeType) {
      setStatus({ kind: 'error', message: invalid ?? 'Only PDF or DOCX files are supported.' });
      return;
    }

    setStatus({ kind: 'working', message: 'Reading your resume…' });
    const bytes = new Uint8Array(await file.arrayBuffer());
    let extractedText = '';
    try {
      const { extractText } = await import('./resume-extract');
      extractedText = await extractText(bytes, mimeType);
    } catch {
      // A failed extraction never blocks the upload: attaching the file is what matters.
      extractedText = '';
    }

    const res = await sendToBackground<ResumeSummary>({ type: 'SET_RESUME', filename: file.name, base64: bytesToBase64(bytes), extractedText });
    if (!res.ok) {
      setStatus({ kind: 'error', message: res.error });
      return;
    }
    setResume(res.data);
    setStatus(
      res.data.wordCount > 0
        ? { kind: 'done', message: 'Resume saved ✓' }
        : { kind: 'warning', message: 'Text extraction failed, but the file is stored.' },
    );
  };

  const onRemove = async () => {
    if (!window.confirm('Remove your stored resume?')) return;
    const res = await sendToBackground<null>({ type: 'DELETE_RESUME' });
    if (res.ok) setResume(null);
    setStatus(res.ok ? { kind: 'done', message: 'Resume removed.' } : { kind: 'error', message: 'Could not remove the resume.' });
  };

  const busy = status.kind === 'working';

  return (
    <section aria-labelledby="h-resume">
      <h2 id="h-resume">Resume</h2>
      <p className="hint section-note">
        Attached to resume upload fields when you click Fill. PDF or DOCX, up to 5 MB. Stored only in this browser,
        never sent anywhere by Job Autofill.
      </p>

      {resume ? (
        <dl className="resume-card" aria-label="Current resume">
          <dt>File</dt>
          <dd className="resume-name">{resume.filename}</dd>
          <dt>Size</dt>
          <dd>{formatBytes(resume.size)}</dd>
          <dt>Uploaded</dt>
          <dd>{new Date(resume.uploadedAt).toLocaleString()}</dd>
          <dt>Extracted text</dt>
          <dd>{resume.wordCount > 0 ? `${resume.wordCount.toLocaleString()} words` : 'None (extraction failed)'}</dd>
        </dl>
      ) : (
        status.kind !== 'working' && <p className="hint">No resume uploaded.</p>
      )}

      <input ref={picker} type="file" accept={RESUME_ACCEPT} hidden onChange={(e) => void onPick(e)} data-testid="resume-picker" />
      <div className="resume-actions">
        <button type="button" disabled={busy} onClick={() => picker.current?.click()}>
          {resume ? 'Replace' : 'Upload resume'}
        </button>
        {resume && (
          <button type="button" className="secondary" disabled={busy} onClick={() => void onRemove()}>
            Remove
          </button>
        )}
        <span className={`status ${status.kind}`} role="status" aria-live="polite">
          {status.message}
        </span>
      </div>
    </section>
  );
}
