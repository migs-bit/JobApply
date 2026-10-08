// A React form that reads its own state on submit, like a real application
// form. Some fields commit their value the way form libraries often do: only
// on blur. A fill that fires just `input` + `change` shows the value on the
// page but leaves that state empty, so it would submit blank. That's the bug
// the full event sequence fixes. window.__submitted holds what a submit sent.
import { useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';

function App() {
  const [first, setFirst] = useState('');
  const [email, setEmail] = useState('');
  const [country, setCountry] = useState('');
  // Committed on blur only (react-hook-form / Formik "validate on blur" style).
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  // Fields the user has "touched": set on focus, as form libraries track it.
  const [touched, setTouched] = useState<string[]>([]);
  const touch = (name: string) => setTouched((t) => (t.includes(name) ? t : [...t, name]));

  const onSubmit = (e: FormEvent) => {
    e.preventDefault(); // never leaves the page
    (window as unknown as { __submitted: object }).__submitted = { first, email, country, city, state, touched: [...touched].sort() };
  };
  return (
    <form id="react-form" onSubmit={onSubmit}>
      <label htmlFor="s-first">First name</label>
      <input id="s-first" value={first} onFocus={() => touch('first')} onChange={(e) => setFirst(e.target.value)} />
      <label htmlFor="s-email">Email</label>
      <input id="s-email" type="email" value={email} onFocus={() => touch('email')} onChange={(e) => setEmail(e.target.value)} />
      <label htmlFor="s-country">Country</label>
      <select id="s-country" value={country} onFocus={() => touch('country')} onChange={(e) => setCountry(e.target.value)}>
        <option value="">Select…</option>
        <option value="US">United States</option>
        <option value="CA">Canada</option>
      </select>
      <label htmlFor="s-city">City</label>
      <input id="s-city" defaultValue="" onBlur={(e) => setCity(e.target.value)} />
      <label htmlFor="s-state">State / Province</label>
      <select id="s-state" defaultValue="" onBlur={(e) => setState(e.target.value)}>
        <option value="">Select…</option>
        <option value="ON">Ontario</option>
        <option value="QC">Quebec</option>
      </select>
      <button type="submit">Submit</button>
    </form>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
