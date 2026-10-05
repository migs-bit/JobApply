// React radio groups, to prove a fill uses a real click (component state
// updates) and that a page which refuses the click is reported as reverted.
// Exposes state on window.__radioState.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';

function App() {
  const [auth, setAuth] = useState('');
  (window as unknown as { __radioState: object }).__radioState = { auth };
  return (
    <form>
      <fieldset>
        <legend>Are you legally authorized to work in the United States?</legend>
        {['Yes', 'No'].map((v) => (
          <label key={v}>
            <input type="radio" name="auth" value={v} checked={auth === v} onChange={() => setAuth(v)} /> {v}
          </label>
        ))}
      </fieldset>
      {/* Controlled but never updated: React restores "nothing selected" after every click. */}
      <fieldset>
        <legend>Do you require visa sponsorship?</legend>
        {['Yes', 'No'].map((v) => (
          <label key={v}>
            <input type="radio" name="sponsor" value={v} checked={false} onChange={() => {}} /> {v}
          </label>
        ))}
      </fieldset>
    </form>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
