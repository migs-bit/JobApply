# Job Autofill

A Chrome extension that fills in the repetitive parts of job applications (name, email, phone, address, links) from a profile stored only on your computer.

- **Private by design.** No account, no server, no network requests, and no telemetry. Your profile never leaves your browser. The developer receives no data and pays for no API usage.
- **Explainable.** It uses deterministic matching rules, not a black box, and every filled field shows why it was matched and how confident the match is.
- **You stay in control.** It never submits anything, never overwrites what's already typed, and has one-click Undo.
- **Open source**, [MIT licensed](LICENSE).

> **Status: MVP v1** (tag `mvp-v1`). Tested on Lever and Ashby application forms. See [MVP.md](MVP.md) for what's built, what's tested, and what's deferred.

## What it does

1. **You click Fill this page.** The extension finds the form fields on the current tab.
2. **It matches each field to your profile.** For example, "Full name ✱" → your first and last name, and "LinkedIn URL" → your LinkedIn link.
3. **It fills the matched fields** that are empty and visible, in a way that works with React and other modern web frameworks.
4. **A small panel lists everything it filled,** with confidence scores. Low-confidence fills are highlighted in yellow for you to double-check, and **Undo** reverts them.

Profile fields:
- **Personal and address:** first and last name, email, phone, address (two lines, city, state, postal code, country).
- **Links:** LinkedIn, GitHub, website.
- **Job preferences:** desired salary, notice period.
- **Work eligibility (Yes/No):** authorized to work, needs sponsorship, willing to relocate.
- **Optional voluntary self-identification (EEO):** gender, race/ethnicity, veteran status, disability status.

Eligibility and EEO answers are picked from fixed choices on the options page. Forms word the dropdown options differently ("I am not a veteran" vs "I am not a protected veteran"), so each answer is matched against a list of known wordings:
- the comparison ignores case, spacing and punctuation, but must match the **whole** option text, so "Male" never selects "Female";
- if no option fits, or two options fit equally, the dropdown is skipped rather than guessed.

**EEO, eligibility, and salary answers are always flagged for review,** so you see them before submitting.

## What it doesn't do (yet)

| Not supported | What happens |
|---|---|
| **Workday** and other heavily customized application systems | Not supported or tested. Their forms are built from custom widgets and multi-step flows. |
| **Forms inside iframes**, e.g. Greenhouse forms embedded on a company's careers page | Not scanned. Open the form on its own page (boards.greenhouse.io) instead. |
| **Custom widgets**: type-to-search boxes, custom dropdowns, shadow DOM components | Not filled. Only standard text inputs, text areas, and plain `<select>` dropdowns are filled. |
| **File uploads** (resume, cover letter) | Not supported. You attach files yourself. |
| **Checkboxes, radio buttons, open-ended questions** ("Why do you want to work here?") | Left for you. Detected, but never filled. |
| **Submitting or clicking "Next"** | Never. Multi-page forms need a click on **Fill this page** for each page. |
| **AI-written answers** | Not in this version. A future optional AI fallback will require **your own** API key and explicit consent before first use. |

## Install

There's no Chrome Web Store listing yet; install from source. Requires Node 20+ and Chrome 120+.

```bash
git clone <this repo> && cd <repo>
npm ci
npm run build
```

1. In Chrome, open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and choose the `dist/` folder.
3. The profile page opens automatically. Enter your details and click **Save**. To reopen it later: right-click the extension icon → **Options**.

## Use

1. Open a job application form, e.g. a Lever `/apply` page or an Ashby posting's **Application** tab.
2. Click the extension icon → **Fill this page**.
3. Review the panel in the top-right corner:
   - **Yellow rows** (and yellow outlines on the page) are low-confidence; check them.
   - **Undo** restores the fields it filled, but leaves anything you've edited since.
   - **Close** or **Esc** dismisses the panel. It closes on its own when everything is high-confidence.
4. Fill in the rest yourself: custom questions, file uploads, checkboxes. Then submit as usual.

If nothing can be filled, the popup stays open and says why, e.g. "No form fields found on this page." Browser pages like `chrome://` are off-limits to all extensions.

## How it decides what goes where

Each field goes through three matching tiers in order, and the first match wins:

| Tier | Signal | Confidence |
|---|---|---|
| 1. Autocomplete | The page's own `autocomplete="email"`-style hint | 1.0 |
| 2. Dictionary | Word patterns in the field's label and name | 0.9 |
| | The same patterns in its placeholder or short nearby text | 0.7 |
| 3. Fuzzy | Word overlap with synonym phrases ("Best number to reach you" → phone) | 0.6 max |

- **Flagged for review:** anything below 0.8. That covers every Tier 3 match, which is why fuzzy fills always show in yellow.
- **Left for you:** anything that matches no tier.
- **Type rules:** a field's type limits what it can match. An email box can only get your email, and a dropdown only a country or state.
- **Guarded against false positives:** "Referrer email" and "Company website" stay unmatched, and "Please *state* your salary…" is a salary question, not a state field.
- **Guarded against flipped answers:** "Authorized to work?" wants Yes and "Require sponsorship?" wants No. A question mixing the two ("authorized to work *without* sponsorship?") is left for you, and so are "relocation *assistance*" and "*current* salary" questions.
- **Question text counts for question keys only.** Sponsorship, authorization, relocation, salary and notice-period questions can match from the question text around a field, as on Lever's custom question cards, at review-level confidence. EEO answers only match a field's own label or name.

## Privacy and security

- **No network access at all.** There is no network code, and the extension's Content Security Policy (`default-src 'none'`) blocks requests as a backstop.
- **Minimal permissions:** `storage`, `activeTab`, and `scripting`. There are no website permissions, so Chrome shows no install warnings, and the extension can only touch a tab after you click **Fill this page** on it.
- **Your profile stays in the extension's background process.** A web page only ever receives the values for the fields actually being filled. The popup and logs never contain profile values.
- **Hidden fields are never filled,** whether transparent, clipped, 1px, or off-screen. Hidden fields are a known autofill-phishing trick for harvesting data you never see being filled.
- **The results panel is isolated from the page.** It's built in a closed shadow root, and page text is inserted only as plain text, so a hostile page can't read it, restyle it, or inject content into it.
- **Supply chain.** Dependency versions are pinned exactly, npm install scripts are disabled, and the only runtime dependencies are React and React DOM.

Found a vulnerability? See [SECURITY.md](SECURITY.md).

## Development

```bash
npm run dev        # rebuild on change, with debug logging (reload the extension after each build)
npm test           # unit tests (Node's built-in runner)
npm run build      # typecheck + tests + production build (debug logging compiled out)
```

**Debug output:** with a dev build, open the page's DevTools console before clicking **Fill this page**. You'll see tables of:
- detected fields, and skipped controls with the reason each was skipped;
- how each field was matched, with `evidence` explaining why, e.g. `label "Email ✱" matched /\be ?mail\b/`;
- fill results;
- one row per dropdown, with its key, the option chosen (or why none was), and the options available.

Text-field values are never logged. Dev builds do log which dropdown option was chosen, to make matching problems diagnosable. Production builds log nothing.

**Test pages:** `python3 -m http.server 8000 --directory test-page`, then open:
- `index.html`: a sample application;
- `scanner-cases.html`: scanner edge cases;
- `filler-cases.html`: fill and safety cases;
- `eeo-cases.html`: eligibility, salary, EEO and dropdown-matching cases.

Every control on the case pages declares its expected result.

**Layout:**

```
src/background/   service worker: storage, message validation, resolver (tiers 1-3), fill plan
src/content/      injected on click: scanner, filler, results panel
src/popup/        "Fill this page" popup
src/options/      profile editor
src/shared/       types, constants, validation
tests/            unit tests
test-page/        fixture pages for manual checks
```

## Roadmap

See [ROADMAP.md](ROADMAP.md): iframe-embedded forms (iCIMS, embedded Greenhouse), radio buttons, custom widgets, and more.

## Contributing

Issues and PRs are welcome. The most useful contributions right now:
- **Bug reports:** paste the dev-build console tables for a form that fills incorrectly.
- **Dictionary improvements:** additions to [`dictionary.ts`](src/background/resolver/dictionary.ts), each with a unit test.

**Site adapters** (Tier 4, planned) will each be one small file per site, in their own folder, with a fixture page and tests. Contribution guidelines for them will be added once the adapter interface exists.

## License

MIT, see [LICENSE](LICENSE).
