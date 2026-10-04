# MVP v1: summary

> **Historical record** of the `mvp-v1` tag (version `0.1.0`). Later changes are in [CHANGELOG.md](CHANGELOG.md). The browser end-to-end harnesses mentioned below as "not yet in the repo" have since been rebuilt in `tests/e2e/`.

Tag `mvp-v1` on branch `MVPv1`, September 2026. The original spec, including the step 4 addendum, is in [Brief.md](Brief.md).

## What's built

| Step | What | Commit |
|---|---|---|
| 1–4 | Manifest V3 shell and strict content security policy. Service-worker message router with sender and shape validation. Profile storage with sanitizing and validation, locked to extension contexts. React options page. | `98aa25b` |
| 5 | Generic DOM scanner: labels (`for`, wrapping, `aria-labelledby`), unique re-findable selectors, context text around each field, skip reasons. Injected on click only. | `b1e4ae0` |
| 6 | Resolver Tier 1 (autocomplete) and Tier 2 (dictionary), running in the service worker. Every result records *why* it matched. | `399aff9`, `95ca2aa` |
| 7 | Filler: React-safe value setter, with checks at fill time. Never overwrites, never truncates, never fills hidden fields. | `c194fb3` |
| 8 | Popup with **Fill this page**. The popup never holds profile data. | `b1fde8f` |
| 9 | Results panel: confidence, source tier, yellow review rows, Undo, auto-dismiss. The popup closes so it doesn't cover the panel. | `5822883` |
| 10 | Resolver Tier 3: fuzzy token-overlap matching, capped at 0.6 confidence and always flagged for review. | `f15cabc` |

### Changes from Brief.md, decided along the way

- **Resolver keys and results**
  - `fullName` is a derived key (first + last name), because Lever and Ashby both use a single full-name field.
  - `ResolvedField` gained `evidence`: why a field matched, or why it didn't.
  - `FillInstruction` gained `fieldId` and `key`.
- **Messaging**
  - `RESOLVE_FIELDS` returns a `FillPlan`. Match results never carry values; fill instructions carry values only for matched fields that have a saved value.
  - The popup sends `FILL_PAGE` to the content script and gets back counts only (`FillSummary`).
- **Manifest**
  - `activeTab` and `scripting` are declared; `activeTab` must be declared for the on-click grant to work. There are no host permissions.
  - The popup lives at `popup/popup.html`, because the build keeps the source folder layout.
- **Dictionary**
  - Patterns match whole words only, after normalizing labels and names.
  - "Someone else's details" wording is excluded ("Referrer email", "Company website").
  - Verb uses of key words are excluded ("please *state* your…").
  - The website pattern never matches a bare "URL", so "Project URL" and "Twitter URL" stay unmatched.
  - Field types limit which keys can match.
- **Scanner:** the context text around a field skips the field's own label, its answer options and wrapping buttons. It can climb through any container type, which Lever's card questions need.
- **Filler:** the brief's `setNativeValue` also handles `<select>`.

## What's tested

**In the repo: 55 unit tests** (`npm test`, which also runs on every `npm run build`), covering:
- **Resolver tiers:** the autocomplete-token parsing, the dictionary (including real Lever and Ashby field shapes) and the fuzzy tier.
- **False-positive guards:** "excellent" isn't "cell", "United States" isn't a state field, and neither are referrer, company or salary questions.
- **Type rules:** field-type compatibility, and never mapping password, checkbox, radio or file inputs.
- **Fill plan:** match results carry no profile values.
- **Popup:** the status wording.

**In the repo: fixture pages** in `test-page/` for manual checks. `scanner-cases.html` and `filler-cases.html` declare the expected result on every control.

**Browser end-to-end: 91 checks in headless Chrome, not yet in the repo.** These harness scripts were run for every step during development, from a scratch folder, and aren't committed. Porting them is the first recommendation below. At the final run, all 91 passed, alongside the 55 unit tests:

| Area | Checks | Covers |
|---|---|---|
| Steps 1–4 | 20 | Manifest and CSP accepted by Chrome. Zero network requests, proven with a local server that received nothing. Options save and reload. Hostile messages rejected. Profile input sanitized. |
| Scanner | 12 | Every fixture expectation. Prefilled values never read. Stable IDs. Production build logs nothing. |
| Resolve (live) | 14 | Real Lever, Ashby and Replit postings, read-only with no profile saved. Standard fields matched, no false website matches, fuzzy confidence capped. |
| Fill | 12 | Every fixture outcome, including hidden-field phishing variants. React component state. A script-free copy of the real Lever form. Password and missing-element guards. No values in any log. |
| Popup | 14 | Real popup opened over a tab. Permissions and Chrome's install-warning check (none). Inject once, fill, status, self-close. Error pages. |
| Results panel | 19 | Closed shadow root. Rows and review highlighting. Undo, including leaving user edits and resetting React state. Close, Esc, auto-dismiss. Strict page CSP plus hostile page CSS. |

**Manual:** steps 5–10 were verified by hand on real Lever and Ashby postings.

## Deliberately deferred

| Deferred | Why |
|---|---|
| Tier 4: site adapters | The brief adds these one site at a time, after the generic path is solid. |
| Tier 5: AI fallback (your own key) | Needs network code, a one-time consent prompt, and key handling. It's out of scope for a zero-network MVP; the options page has a disabled placeholder. |
| Workday and similar systems | Custom widgets and multi-step flows need adapters. |
| Iframes and shadow DOM | MVP scope. Embedded Greenhouse forms are the main casualty. |
| Custom widgets (type-to-search, custom dropdowns) | These need per-widget interaction, not value setting. |
| File uploads, checkboxes, radios | MVP fills text fields only. |
| Answering open-ended questions | Out of scope. It's the job of the future AI tier or an answer bank. |
| More profile keys (location, current company, work authorization, …) and an answer bank | Post-MVP. The Profile type is built to be extended. |
| Multi-language forms | The dictionary is English-only. |
| Chrome Web Store release | Icons are placeholders; no store listing yet. |

## Known limitations

- **Covered fields:** a field covered by another element is still filled. There's no check for fields hidden behind overlays; hidden, transparent, clipped and off-screen fields *are* caught.
- **Dropdowns:** an option is chosen only if its visible text or its value equals the saved value exactly (ignoring case). A saved "Canada" selects `<option value="CA">Canada</option>`, but not an option labelled "Canada (CA)" or "CAN".
- **Type-to-search fields:** location or country boxes like Lever's "Current location" and Ashby's country picker are detected but not filled.
- **Full name:** filled only when both first and last name are saved.
- **Pages that re-render:** if a page re-renders between scan and fill, affected fields are skipped with "element not found" rather than guessed.
- **Tier 3 is unproven on real forms:** it made zero matches across 157 live Lever, Ashby and Replit fields. That means no false positives, but also no demonstrated benefit on those forms, where Tiers 1–2 already cover the standard fields.
- **Browser coverage:** tested on Chrome 153 only. The declared minimum is 120; restricting storage access needs a recent Chrome, and older versions just skip that hardening, since content scripts never read storage anyway.
