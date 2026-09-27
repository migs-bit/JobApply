# JobApply Autofill (MVP)

A Chrome Manifest V3 extension that autofills job applications. It scans the form on the current page, asks **Jev** (a decision model) to classify each field into a canonical key, maps those keys to your saved profile, and fills the DOM in a way that React-controlled inputs pick up.

## How it works

```
 toolbar click
      │
      ▼
 service-worker.ts ──START_AUTOFILL──▶ content-script.ts
                                           │ scanForm()            (dom-scanner.ts)
                                           │ FieldCandidate[]
      ◀────────────CLASSIFY_AND_PLAN───────┘
 classifyFields()   → Jev (jev-client.ts)
 getProfile()       → chrome.storage.local (profile-store.ts)
 generateAnswer()   → LLM placeholder (llm-client.ts), custom questions only
 FillInstruction[] ────────response───────▶ applyFillInstructions() (dom-filler.ts)
                                            showConfirmationOverlay() (confirmation-ui.ts)
```

- **Confidence ≥ 0.8:** filled.
- **0.5–0.8:** filled, but outlined in amber and flagged "review" in the overlay.
- **< 0.5, `unknown`, or no profile value:** skipped.
- **`custom_question`:** the LLM placeholder runs and logs its draft, but nothing is filled (MVP).
- Fields that already have a value are never overwritten.

## Project layout

```
manifest.json                      MV3 manifest (copied into dist/ at build)
vite.config.ts                     two-pass build (see below)
src/shared/types.ts                FieldCandidate, JevClassification, FillInstruction, Profile, messages
src/background/service-worker.ts   orchestration + toolbar click handler
src/background/api/jev-client.ts   classifyFields() → Jev (fake endpoint + local fallback)
src/background/api/llm-client.ts   generateAnswer() placeholder
src/background/storage/profile-store.ts
src/content/content-script.ts      entry point in the page
src/content/scanner/dom-scanner.ts
src/content/filler/dom-filler.ts   setNativeValue() + event dispatch
src/content/overlay/confirmation-ui.ts
src/options/options.html|tsx       React profile editor
test-page/index.html               sample application form for manual testing
```

### Why two builds?

MV3 content scripts can't be ES modules, but the service worker and options page can. `vite build` produces `background.js` and the options page. `vite build --mode content` produces `content.js` as a single self-contained IIFE, so it never contains an `import` pointing at a shared chunk.

## Setup

Requires Node 20+.

```bash
npm install
npm run build        # typecheck + build into dist/
```

Load it in Chrome:

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and select the `dist/` folder.
3. The options page opens on first install. Fill in your profile and click **Save**. You can reopen it later from the extension's **Details → Extension options**.

### Development

```bash
npm run dev          # rebuilds dist/ on file changes (both passes)
```

After a rebuild, click the reload icon on the extension card in `chrome://extensions`, then refresh the page you're testing.

### Try it

1. Serve the sample form:
   ```bash
   python3 -m http.server 8000 --directory test-page
   ```
2. Open http://localhost:8000 and click the extension's toolbar icon.
3. Fields fill in, and an overlay in the top-right lists each field with its key, confidence, and status. Click a row to jump to that field.

To debug:

- **Content-script logs:** the page's DevTools console, filtered by `[JobApply]`.
- **Background logs (including the Jev request and response):** open `chrome://extensions` and click **service worker** on the extension card.

## Wiring up Jev

`src/background/api/jev-client.ts`:

- Set `JEV_ENDPOINT` and `JEV_API_KEY`.
- The request body is `{ categories: CanonicalKey[], items: [{ id, features }] }`. Adjust it to Jev's real schema.
- The response is expected to be `Array<{ fieldId, key, confidence }>`. `parseJevResponse` validates it.
- Once Jev is live, set `USE_LOCAL_FALLBACK = false`. The fallback is a keyword heuristic that exists only so the pipeline runs end to end while the endpoint is fake.

> ⚠️ Anything bundled into an extension can be read by users. For production, route Jev and LLM calls through your own backend instead of shipping API keys in the extension.

## MVP limitations

- Only the top-level document is scanned: no iframes (e.g. embedded Greenhouse/Lever forms) and no shadow DOM.
- Only text, email, tel, url, and search inputs, plus textarea and simple select matching. No file upload.
- Custom questions are classified but not answered.
- No site-specific adapters.
