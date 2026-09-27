/**
 * Options page — a simple profile editor. Reads/writes the Profile in
 * chrome.storage.local via profile-store (shared with the service worker).
 */
import { StrictMode, useEffect, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { getProfile, saveProfile } from '../background/storage/profile-store';
import { EMPTY_PROFILE, type Profile } from '../shared/types';

type Status = 'loading' | 'idle' | 'saving' | 'saved' | 'error';

function OptionsApp() {
  const [profile, setProfile] = useState<Profile>(EMPTY_PROFILE);
  const [status, setStatus] = useState<Status>('loading');

  useEffect(() => {
    getProfile()
      .then((p) => {
        setProfile(p);
        setStatus('idle');
      })
      .catch(() => setStatus('error'));
  }, []);

  const update =
    (field: keyof Profile) =>
    (e: { target: { value: string } }) => {
      setProfile((p) => ({ ...p, [field]: e.target.value }));
      if (status === 'saved') setStatus('idle');
    };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setStatus('saving');
    try {
      await saveProfile(profile);
      setStatus('saved');
    } catch {
      setStatus('error');
    }
  };

  const statusText: Record<Status, string> = {
    loading: 'Loading…',
    idle: '',
    saving: 'Saving…',
    saved: 'Saved ✓',
    error: 'Something went wrong — check the console.',
  };

  return (
    <main>
      <h1>Your profile</h1>
      <p className="hint">Stored locally in this browser and used to autofill job applications.</p>

      <form onSubmit={onSubmit}>
        <div className="row">
          <label>
            First name
            <input value={profile.firstName} onChange={update('firstName')} autoComplete="given-name" />
          </label>
          <label>
            Last name
            <input value={profile.lastName} onChange={update('lastName')} autoComplete="family-name" />
          </label>
        </div>
        <div className="row">
          <label>
            Email
            <input type="email" value={profile.email} onChange={update('email')} autoComplete="email" />
          </label>
          <label>
            Phone
            <input type="tel" value={profile.phone} onChange={update('phone')} autoComplete="tel" />
          </label>
        </div>
        <label>
          LinkedIn URL
          <input
            type="url"
            value={profile.linkedin}
            onChange={update('linkedin')}
            placeholder="https://www.linkedin.com/in/your-handle"
          />
        </label>
        <label>
          Resume (plain text)
          <textarea
            value={profile.resumeText}
            onChange={update('resumeText')}
            placeholder="Paste your resume text here…"
          />
        </label>

        <div className="actions">
          <button type="submit" disabled={status === 'loading' || status === 'saving'}>
            Save
          </button>
          <span className="status" role="status">
            {statusText[status]}
          </span>
        </div>
      </form>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <OptionsApp />
  </StrictMode>,
);
