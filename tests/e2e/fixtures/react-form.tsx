// A React form with controlled inputs, used to prove the filler updates React
// state (not just the DOM). Exposes the state on window.__reactState.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';

function App() {
  const [first, setFirst] = useState('');
  const [email, setEmail] = useState('');
  const [country, setCountry] = useState('');
  (window as unknown as { __reactState: object }).__reactState = { first, email, country };
  return (
    <form>
      <label htmlFor="r-first">First name</label>
      <input id="r-first" value={first} onChange={(e) => setFirst(e.target.value)} />
      <label htmlFor="r-email">Email</label>
      <input id="r-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <label htmlFor="r-country">Country</label>
      <select id="r-country" value={country} onChange={(e) => setCountry(e.target.value)}>
        <option value="">Select…</option>
        <option value="CA">Canada</option>
      </select>
      {/* Controlled with no onChange: React restores '' after every input, so a fill must report "failed". */}
      <label htmlFor="r-locked">Last name</label>
      <input id="r-locked" value="" />
    </form>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
