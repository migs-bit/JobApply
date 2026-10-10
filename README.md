# Job Autofill

A Chrome extension that fills in the repetitive parts of job applications (name, email, phone, address, links, and your resume) from a profile stored only on your computer.

- **Private by design.** No account, no server, no network requests, and no telemetry. Your profile never leaves your browser. The developer receives no data and pays for no API usage.
- **Explainable.** It uses deterministic matching rules, not a black box, and every filled field shows why it was matched and how confident the match is.
- **You stay in control.** It never submits anything, never overwrites what's already typed, and has one-click Undo.
- **Open source**, [MIT licensed](LICENSE).

> **Status:** MVP v1 (`0.1.0`, tag `mvp-v1`) plus Phases 1–4: expanded profile and dropdowns, radio questions, "Teach this", and resume upload. Tested on Lever and Ashby application forms.
> - What changed: [CHANGELOG.md](CHANGELOG.md)
> - What's next: [ROADMAP.md](ROADMAP.md)

## What it does

1. **You click Fill this page.** The extension finds the form fields on the current tab.
2. **It matches each field to your profile.** For example, "Full name ✱" → your first and last name, and "LinkedIn URL" → your LinkedIn link.
3. **It fills the matched fields** that are empty and visible, the way a person would: it focuses each field, types or picks the value, and leaves it. That way React and form libraries record the value too, not just the page.
4. **It double-checks.** A moment after filling, it re-reads every field it filled. If the page changed one back, that field is reported as "page reverted" instead of filled.
5. **A small panel lists everything it filled,** with confidence scores. Low-confidence fills are highlighted in yellow for you to double-check, and **Undo** reverts them.

Profile fields:
- **Personal and address:** first and last name, email, phone, address (two lines, city, state, postal code, country).
- **Links:** LinkedIn, GitHub, website.
- **Job preferences:** desired salary, notice period.
- **Work eligibility (Yes/No):** authorized to work, needs sponsorship, willing to relocate.
- **Optional voluntary self-identification (EEO):** gender, race/ethnicity, veteran status, disability status.
- **Resume:** one PDF or DOCX file, attached to resume upload fields (see [Upload your resume](#upload-your-resume)).

Eligibility and EEO answers are picked from fixed choices on the options page, and fill both dropdowns and radio-button questions. A radio group is treated as one question: it's matched on the question text, never on a lone "Yes", and answered with a real click. Forms word the dropdown options differently ("I am not a veteran" vs "I am not a protected veteran"), so each answer is matched against a list of known wordings:
- the comparison ignores case, spacing and punctuation, but must match the **whole** option text, so "Male" never selects "Female";
- if no option fits, or two options fit equally, the dropdown is skipped rather than guessed.

**EEO, eligibility, and salary answers are always flagged for review,** so you see them before submitting.

## What it doesn't do (yet)

| Not supported | What happens |
|---|---|
| **Workday** and other heavily customized application systems | Not supported or tested. Their forms are built from custom widgets and multi-step flows. |
| **Forms inside iframes**, e.g. Greenhouse forms embedded on a company's careers page | Not scanned. Open the form on its own page (boards.greenhouse.io) instead. |
| **Custom widgets**: type-to-search boxes, custom dropdowns, shadow DOM components | Not filled. Only standard text inputs, text areas, and plain `<select>` dropdowns are filled. |
| **File uploads other than your resume** (cover letter, transcript, portfolio, writing sample) | Left for you. Only resume fields get a file, and only your one stored resume. |
| **Checkboxes and open-ended questions** ("Why do you want to work here?") | Left for you. Detected, but never filled. |
| **Radio questions you haven't answered in your profile**, or custom ones ("Have you built…?") | Left for you. Only work-eligibility and EEO radio questions are answered. |
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
   - **"Didn't stick" rows** (also yellow) are fields the page refused or changed back after filling, e.g. "page reverted". Fill those in yourself. The panel stays open when there are any.
   - **Undo** restores the fields it filled, but leaves anything you've edited since.
   - **Close** or **Esc** dismisses the panel. It closes on its own when everything is high-confidence.
4. Fill in the rest yourself: custom questions, other file uploads, checkboxes. Then submit as usual.

If nothing can be filled, the popup stays open and says why, e.g. "No form fields found on this page." Browser pages like `chrome://` are off-limits to all extensions.

## How it decides what goes where

Each field goes through four matching tiers in order, and the first match wins:

| Tier | Signal | Confidence |
|---|---|---|
| 1. Autocomplete | The page's own `autocomplete="email"`-style hint | 1.0 |
| 2. Dictionary | Word patterns in the field's label and name | 0.9 |
| | The same patterns in its placeholder or short nearby text | 0.7 |
| 3. Learned | An answer you taught for this exact question ("Teach this", below) | 0.85 (typed answers always reviewed) |
| 4. Fuzzy | Word overlap with synonym phrases ("Best number to reach you" → phone) | 0.6 max |

- **Flagged for review:** anything below 0.8. That covers every Tier 4 match, which is why fuzzy fills always show in yellow.
- **Left for you, or teach it:** anything that matches no tier is listed under "Not filled" in the panel.
- **Type rules:** a field's type limits what it can match. An email box can only get your email, and a dropdown only a country or state.
- **Guarded against false positives:** "Referrer email" and "Company website" stay unmatched, and "Please *state* your salary…" is a salary question, not a state field.
- **Guarded against flipped answers:** "Authorized to work?" wants Yes and "Require sponsorship?" wants No. A question mixing the two ("authorized to work *without* sponsorship?") is left for you, and so are "relocation *assistance*" and "*current* salary" questions.
- **Question text counts for question keys only.** Sponsorship, authorization, relocation, salary and notice-period questions can match from the question text around a field, as on Lever's custom question cards, at review-level confidence. EEO answers only match a field's own label or name.

## Teach this

Forms word the same questions differently, so some fields won't fill. The panel lists them under **Not filled**:
1. Answer the field on the page yourself: type, pick an option, or click a radio.
2. Click **Teach this** next to it.

To teach several at once, answer them all, then click **Teach all**. Untick a row's checkbox to leave it out. Rows you haven't answered are skipped with a reminder.

The answer is remembered, and used the next time a form asks that question:
- **Typed answers** (text boxes, text areas) are always flagged yellow for review, because they can be out of date or specific to one company ("Why do you want to work here?"). The panel stays open until you close it.
- **Dropdown and radio answers** aren't flagged, because they must exactly match one of the page's own options.

- **A custom question** ("How did you hear about us?") is remembered as *question → your answer*.
- **A known question whose options didn't match** (e.g. a veteran-status dropdown worded unusually) is remembered as *this option means my saved answer*. That then works on any site using the same wording.
- **Managing them:** **Options → Learned answers** lets you edit or delete them, one at a time or all at once.
- **What's stored:** only the question or option text. No site or address is kept, and nothing leaves your device.

## Upload your resume

1. Open **Options → Resume** and click **Upload resume**. Pick a PDF or DOCX file, up to 5 MB.
2. The section shows the file's name, size, upload date, and how many words of text were read from it. **Replace** swaps in a new file; **Remove** deletes it.
3. On an application form, **Fill this page** attaches it to the resume upload field ("Resume", "CV", "Attach resume/CV", "Résumé").

What to expect:
- **The panel shows "Resume attached: your-file.pdf"** as a yellow review row, and the panel stays open until you close it. Check that the site accepted the file.
- **Only resume fields get it.** A file field that mentions a cover letter, portfolio, writing sample or transcript is never touched, even "Resume and cover letter".
- **Never over your own file.** A field that already has a file attached is left alone.
- **No resume uploaded?** The panel and popup say "no resume uploaded" when a page asks for one.
- **Some sites read the file as soon as it's attached.** Lever, for example, uploads it to parse it ("Analyzing resume…") before you submit. That's the site's behavior, the same as when you attach the file yourself.
- **Text extraction:** the resume's plain text (up to 20,000 characters) is read once at upload and stored with it, for the planned optional AI feature. Nothing uses it yet. If extraction fails (a scanned PDF, an unusual font), the file is still stored and attached as usual.

## Privacy and security

- **No network access at all.** There is no network code, and the extension's Content Security Policy (`default-src 'none'`) blocks requests as a backstop.
- **Minimal permissions:** `storage`, `activeTab`, and `scripting`. There are no website permissions, so Chrome shows no install warnings, and the extension can only touch a tab after you click **Fill this page** on it.
- **Your profile stays in the extension's background process.** A web page only ever receives the values for the fields actually being filled. The popup and logs never contain profile values.
- **Learned answers stay local:** stored like your profile, never logged, never sent anywhere. "Teach this" reads only the one field you clicked it for, and only on a real click; a page can't trigger it.
- **Your resume stays local:** stored like your profile, with no site or URL. Its text is extracted inside the extension (no network), and never leaves it. A page receives the file only when it has a resume field being filled, and never receives the extracted text.
- **Hidden fields are never filled,** whether transparent, clipped, 1px, or off-screen. Hidden fields are a known autofill-phishing trick for harvesting data you never see being filled.
- **The results panel is isolated from the page.** It's built in a closed shadow root, and page text is inserted only as plain text, so a hostile page can't read it, restyle it, or inject content into it.
- **Supply chain.** Dependency versions are pinned exactly, and npm install scripts are disabled. The runtime dependencies are React and React DOM, plus PDF.js (`pdfjs-dist`) and `mammoth` for reading resume text. Those two load only on the options page, when you upload a file.

Found a vulnerability? See [SECURITY.md](SECURITY.md).

## Development

```bash
npm run dev        # rebuild on change, with debug logging (reload the extension after each build)
npm test           # unit tests (Node's built-in runner)
npm run test:e2e   # browser end-to-end suites in headless Chrome (see [CONTRIBUTING.md](CONTRIBUTING.md#tests))
npm run build      # typecheck + tests + production build (debug logging compiled out)
```

**Debug output:** with a dev build, open the page's DevTools console before clicking **Fill this page**. You'll see tables of:
- detected fields, and skipped controls with the reason each was skipped;
- how each field was matched, with `evidence` explaining why, e.g. `label "Email ✱" matched /\be ?mail\b/`;
- fill results;
- one row per dropdown, with its key, the option chosen (or why none was), and the options available.

Text-field values are never logged. Dev builds do log which dropdown option was chosen, to make matching problems diagnosable. Production builds have no debug logging. See [SECURITY.md](SECURITY.md#logging-policy).

**Test pages:** `python3 -m http.server 8000 --directory test-page`, then open:
- `index.html`: a sample application;
- `scanner-cases.html`: scanner edge cases;
- `filler-cases.html`: fill and safety cases;
- `eeo-cases.html`: eligibility, salary, EEO and dropdown-matching cases;
- `radio-cases.html`: radio groups;
- `learn-cases.html`: "Teach this";
- `resume-cases.html`: resume upload (upload a resume in Options first);
- `robust-cases.html`: event sequences and values the page reverts.

Every control on the case pages declares its expected result.

**Layout:**

```
src/background/   service worker: storage, message validation, resolver (tiers 1-3), fill plan
src/content/      injected on click: scanner, filler, results panel
src/popup/        "Fill this page" popup
src/options/      profile editor, resume upload and text extraction, learned answers
src/shared/       types, constants, validation
tests/            unit tests
test-page/        fixture pages for manual checks
```

## Roadmap

See [ROADMAP.md](ROADMAP.md). Next up: type-to-search widgets, iframe-embedded forms (iCIMS, then embedded Greenhouse), and the optional AI tier (your own key).

## Contributing

Issues and PRs are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for:
- building and testing;
- adding a profile key, a dropdown synonym, or a dictionary pattern;
- the planned shape of site adapters.

The most useful bug report is a dev build's console tables for a form that fills incorrectly. Redact them first: they can include your dropdown answers.

## License

MIT, see [LICENSE](LICENSE).
