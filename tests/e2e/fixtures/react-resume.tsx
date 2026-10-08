// React file inputs, used to prove an attached resume survives React's
// re-renders. Exposes state on window.__resumeState and a way to force a
// re-render on window.__rerender.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';

function App() {
  const [picked, setPicked] = useState('');
  const [renders, setRenders] = useState(0);
  // Remounts its input on every change (a new `key`), so whatever was attached is lost.
  const [generation, setGeneration] = useState(0);
  const w = window as unknown as { __resumeState: object; __rerender: () => void };
  w.__resumeState = { picked, renders, generation };
  w.__rerender = () => setRenders((r) => r + 1);
  return (
    <form>
      <label htmlFor="react-resume">Resume</label>
      <input id="react-resume" type="file" name="resume" onChange={(e) => setPicked(e.target.files?.[0]?.name ?? '')} />
      <p id="picked">{picked}</p>

      <label htmlFor="react-remount">Upload CV</label>
      <input key={generation} id="react-remount" type="file" onChange={() => setGeneration((g) => g + 1)} />
    </form>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
