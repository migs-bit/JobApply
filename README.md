# Job Autofill

A Chrome extension (Manifest V3) that autofills job application forms from a profile you keep on your own device.

- **Local-first.** No data leaves your device in the default configuration. The extension makes no network requests at all: there is no network code, and its Content Security Policy blocks network access as a backstop.
- **No telemetry.** No analytics, no error reporting, and no phone-home.
- **AI is optional (coming later).** A future AI fallback for unusual fields will require **your own** API key and your explicit consent before first use.
- **The developer receives no data and pays for no API usage.** There is no backend.
- **Open source**, [MIT licensed](LICENSE).

> **Status: early MVP.** Build steps 1–9 are done: the extension shell, profile storage, the options page, the form scanner, resolver Tiers 1–2, the filler, the popup, and the confirmation overlay. Click the toolbar icon, then **Fill this page**. Fuzzy matching (Tier 3, step 10) comes next.

## How it works

Every detected form field goes through deterministic tiers. The first match wins, and each fill records which tier matched, so you can always see *why* a field got a value:

1. **Tier 1:** the `autocomplete` attribute.
2. **Tier 2:** label and `name` dictionary patterns
   ([`dictionary.ts`](src/background/resolver/dictionary.ts).
3. **Tier 3:** fuzzy matching against profile keys.
4. **Tier 4 (later):** site adapters.
5. **Tier 5 (later):** optional AI fallback with your own key.

Anything unmatched is left for you to fill in by hand.

## Install (development)

Requires Node 20+ and Chrome 120+.

```bash
npm ci
npm run build
```

1. Open `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked** and select the `dist/` folder.
3. The profile page opens automatically. Fill it in and click **Save**.

`npm run dev` rebuilds on change, with debug logging enabled. After each rebuild, click the reload icon on the extension's card.

`npm test` runs the resolver unit tests with Node's built-in test runner. `npm run build` runs them too.

## Testing (steps 5–9)

1. Run `npm run dev`. The scanner logs only in dev builds; `npm run build` output is silent.
2. Reload the extension on `chrome://extensions`.
3. Open a job application page:
   - **Lever:** the posting's `/apply` page.
   - **Ashby:** the posting's **Application** tab.
   - For offline checks, serve the fixtures with `python3 -m http.server 8000 --directory test-page`. Then open `http://localhost:8000/`, `/scanner-cases.html`, or `/filler-cases.html`. Each control on the case pages declares its expected result.
4. Click the extension's toolbar icon, then **Fill this page**. **This fills the form** with your saved profile; it never submits. When something is filled, the popup closes itself so the results panel (below) isn't hidden behind it. When nothing is filled, the popup stays open and says why, e.g. "No form fields found on this page." For details, open the page's DevTools → **Console** before clicking. You'll see:
   - A summary line.
   - A table of detected fields.
   - The full field objects: right-click → **Copy object** to paste into a bug report.
   - A table of skipped controls, each with a reason.
   - A table of **resolutions**, one row per field:
     - the profile key (or `unknown`), its confidence, and which tier matched;
     - `review` (below 0.8 confidence);
     - `evidence`: *why*, e.g. `label "Email ✱" matched /\be ?mail\b/`.
   - A table of **fill results**: filled, skipped, or failed, with the reason (e.g. `already has a value`, `not visible`). Filled values are never logged, even in dev builds.
5. A panel appears in the page's top-right corner listing each filled field with its value, confidence, and which tier matched it:
   - **Yellow rows** (and a yellow outline on the field itself) are low-confidence and need a quick review. They're listed first.
   - **Undo** puts back what was there before, but leaves any field you've edited since.
   - **Close** or **Esc** dismisses the panel. It closes on its own after a few seconds when everything is high-confidence.
6. Click **Fill this page** again to re-scan, for example after a form section expands. Fields that already have a value are left alone.

## Security model

- **Minimal permissions:** `storage`, `activeTab`, and `scripting`, with no host permissions and no `content_scripts`. The extension can't see any website until you open its popup on a tab, and then only that tab. Chrome shows no install permission warnings.
- **The overlay can't be read or driven by the page.** It lives in a closed shadow root built with `textContent` only, so page-supplied labels can't inject markup. It shows only values the extension just filled, which are already in the page's own fields. Its styles use a constructable stylesheet, so they work under strict page CSPs.
- **The popup holds no profile data.** It asks the page to fill and gets back counts only ("Filled 4 of 5"). The content script accepts that request only from the extension's own pages, never from the website or other extensions.
- **The scanner never reads field values.** It reads labels and surrounding text only, and skips the contents of `<textarea>` and `<select>`.
- **Profile values stay in the service worker.** The resolver runs there and returns keys and confidence only, never profile values.
  - Resolution requests are accepted only from the top frame of a tab.
  - Password, checkbox, radio, and file inputs are never mapped to profile data.
- **Least data to the page.** A profile value goes to the content script only if its field was matched *and* you have saved that value.
- **Safe filling.** Each target is re-checked when it's filled, since the page can change after the scan:
  - It must still be a text-like field, enabled, and empty. Existing values are never overwritten.
  - It must be **visible to you**. Fields that are transparent, clipped, 1px, or off-screen are skipped; hidden fields are a known autofill-phishing trick for harvesting data you never see being filled.
  - A value that doesn't fit the field's `maxlength` is skipped rather than silently truncated.
  - Dropdowns are only set on an exact option match. No guessing.
- **Strict CSP on extension pages:** `default-src 'none'; script-src 'self'`. No inline scripts, no `eval`, and no network connections.
- **One trust boundary.** Only the service worker touches storage, and it validates every message:
  - It checks the message's shape and bounds its size.
  - Profile messages are accepted only from the extension's own pages. Content scripts, which run inside untrusted websites, can never read the full profile.
  - `chrome.storage.local` is restricted to trusted extension contexts.
- **Input sanitizing.** Profile values are stripped of control and bidi-override characters and length-capped. Link fields must be `http(s)` URLs.
- **Production builds never log profile data.** Debug logging is compiled out.
- **Supply chain.** Dependencies are pinned to exact versions, and `.npmrc` disables npm install scripts. The runtime dependencies are only React and React DOM.

To report a vulnerability, see [SECURITY.md](SECURITY.md).

## Contributing

Site adapters (Tier 4) will live in their own folder, one small file per site. Contribution guidelines will be added once that system exists. Until then, issues and PRs for the core tiers are welcome.

## License

MIT, see [LICENSE](LICENSE).
