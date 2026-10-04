/**
 * Options page: edit the profile. All reads/writes go through the service
 * worker (GET_PROFILE / SET_PROFILE), which re-validates everything; the
 * checks here only exist to give instant feedback.
 */
import { StrictMode, useEffect, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import '../shared/theme.css';
import './options.css';
import { EMPTY_PROFILE, LIMITS } from '../shared/constants';
import { sendToBackground } from '../shared/messaging';
import { sanitizeProfile, validateProfile } from '../shared/profile-validation';
import type { Profile, ProfileErrors, ProfileKey } from '../shared/types';
import { CHOICES } from '../shared/choices';
import { SECTIONS, type FieldSpec } from './fields';

type Status = { kind: 'loading' | 'idle' | 'saving' | 'saved' } | { kind: 'error'; message: string };

function OptionsApp() {
  const [profile, setProfile] = useState<Profile>({ ...EMPTY_PROFILE });
  const [errors, setErrors] = useState<ProfileErrors>({});
  const [status, setStatus] = useState<Status>({ kind: 'loading' });

  useEffect(() => {
    void sendToBackground<Profile>({ type: 'GET_PROFILE' }).then((res) => {
      if (res.ok) {
        setProfile(res.data);
        setStatus({ kind: 'idle' });
      } else {
        setStatus({ kind: 'error', message: 'Could not load your profile.' });
      }
    });
  }, []);

  const onChange = (key: ProfileKey, value: string) => {
    setProfile((p) => ({ ...p, [key]: value }));
    setErrors(({ [key]: _cleared, ...rest }) => rest);
    setStatus((s) => (s.kind === 'saved' ? { kind: 'idle' } : s));
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const clientErrors = validateProfile(sanitizeProfile(profile));
    if (Object.keys(clientErrors).length > 0) {
      setErrors(clientErrors);
      setStatus({ kind: 'error', message: 'Fix the highlighted fields.' });
      return;
    }

    setStatus({ kind: 'saving' });
    const res = await sendToBackground<Profile>({ type: 'SET_PROFILE', profile });
    if (res.ok) {
      setProfile(res.data); // reflects normalization, e.g. https:// added to links
      setStatus({ kind: 'saved' });
    } else {
      setErrors(res.fieldErrors ?? {});
      setStatus({ kind: 'error', message: res.fieldErrors ? 'Fix the highlighted fields.' : 'Could not save.' });
    }
  };

  const busy = status.kind === 'loading' || status.kind === 'saving';

  return (
    <main>
      <h1>Your profile</h1>
      <p className="hint intro">
        Stored only in this browser. Job Autofill makes no network requests and never sends your data anywhere.
      </p>

      <form onSubmit={onSubmit} noValidate>
        {SECTIONS.map((section) => (
          <section key={section.title} aria-labelledby={`h-${section.title}`}>
            <h2 id={`h-${section.title}`}>{section.title}</h2>
            {section.note && <p className="hint section-note">{section.note}</p>}
            <div className="grid">
              {section.fields.map((f) => (
                <label key={f.key} className={f.wide ? 'wide' : undefined}>
                  {f.label}
                  <ProfileInput
                    spec={f}
                    value={profile[f.key]}
                    onChange={(value) => onChange(f.key, value)}
                    disabled={status.kind === 'loading'}
                    error={errors[f.key]}
                  />
                  {errors[f.key] && (
                    <span className="field-error" id={`err-${f.key}`}>
                      {errors[f.key]}
                    </span>
                  )}
                </label>
              ))}
            </div>
          </section>
        ))}

        <AiFallbackPlaceholder />

        <div className="actions">
          <button type="submit" disabled={busy}>
            {status.kind === 'saving' ? 'Saving…' : 'Save'}
          </button>
          <span className={`status ${status.kind}`} role="status" aria-live="polite">
            {status.kind === 'saved' && 'Saved ✓'}
            {status.kind === 'loading' && 'Loading…'}
            {status.kind === 'error' && status.message}
          </span>
        </div>
      </form>
    </main>
  );
}

function ProfileInput(props: {
  spec: FieldSpec;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  error: string | undefined;
}) {
  const { spec, value, onChange, disabled, error } = props;
  const a11y = { 'aria-invalid': error ? true : undefined, 'aria-describedby': error ? `err-${spec.key}` : undefined };

  if (spec.kind === 'choice') {
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} {...a11y}>
        <option value="">Not set (leave for me)</option>
        {(CHOICES[spec.key] ?? []).map((c) => (
          <option key={c.code} value={c.code}>
            {c.label}
          </option>
        ))}
      </select>
    );
  }
  return (
    <input
      type={spec.kind ?? 'text'}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      autoComplete={spec.autoComplete}
      maxLength={LIMITS.profileValueLength}
      spellCheck={spec.kind && spec.kind !== 'text' ? false : undefined}
      placeholder={spec.placeholder}
      disabled={disabled}
      {...a11y}
    />
  );
}

/**
 * Reserves the UI for the optional BYO-key AI tier (Tier 5). Intentionally
 * inert: no state, no names, nothing stored. Enabled in a later release.
 */
function AiFallbackPlaceholder() {
  return (
    <fieldset disabled aria-describedby="ai-note">
      <legend>
        AI fallback (optional) <span className="badge">Coming later</span>
      </legend>
      <p className="hint" id="ai-note">
        Coming later. Bring your own API key. Used only for unusual fields the built-in matching can't handle, and
        only after you give consent.
      </p>
      <div className="grid">
        <label>
          Provider
          <select defaultValue="">
            <option value="">None</option>
          </select>
        </label>
        <label>
          API key
          <input type="password" autoComplete="off" placeholder="Not available yet" />
        </label>
      </div>
    </fieldset>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <OptionsApp />
  </StrictMode>,
);
