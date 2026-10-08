# Contributing

Thanks for helping. Two rules are non-negotiable:
- **No network code.** The extension makes no requests, and its CSP enforces that.
- **No profile text values in logs,** in any build. See [SECURITY.md](SECURITY.md).

## Build and test

```bash
npm ci                 # install (npm install scripts are disabled via .npmrc)
npm run dev            # dev build into dist/, rebuilds on change, debug logging on
npm test               # unit tests
npm run test:e2e       # browser end-to-end suites (needs Chrome; see tests/README.md)
npm run build          # typecheck + unit tests + production build into dist/
```

Load `dist/` at `chrome://extensions` → **Load unpacked**, and reload it after each build.

Before opening a PR, run `npm run build` and `npm run test:e2e`. For matching changes, also run `npm run test:e2e:live`, which checks real Lever, Ashby and Replit postings read-only.

## Add a profile key

1. **Type:** add the field to `Profile` in `src/shared/types.ts`.
2. **Key list:** add it to `PROFILE_KEYS` in `src/shared/constants.ts`. A compile-time check fails if you forget. Add it to a group there if it applies:
   - `URL_KEYS`: must be an http(s) URL.
   - `ALWAYS_REVIEW_KEYS`: every fill flagged for review. Use this for anything sensitive.
   - `EEO_KEYS`: only matched from labels and names, never from question prose.
3. **Options page:** add an input in `src/options/fields.ts`. Use `kind: 'choice'` for multiple-choice answers (see the next section).
4. **Matching:** add patterns in `src/background/resolver/dictionary.ts` (next section but one). If dropdowns should be able to hold it, add it to the `select` set in `COMPATIBLE_KEYS` in `src/background/resolver/field-rules.ts`.
5. **Validation:** for special formats, add a rule in `src/shared/profile-validation.ts`. Sanitizing (control characters, length caps) applies to every key automatically.
6. **Tests:** add unit tests (see `tests/profile-keys.test.ts`), and a case to a fixture page if it fills differently.

## Add a synonym to the dropdown choice table

Multiple-choice answers (EEO, work eligibility) live in `CHOICES` in `src/shared/choices.ts`. The profile stores a code (`not_veteran`); each code lists the option texts that mean it.

- **Order matters:** put the most specific wording first. The first synonym that equals exactly one option wins.
- **Whole-string matching:** synonyms are compared to option text (or value) as whole strings, after normalizing case, punctuation and spacing. Never as substrings, so a short synonym like "No" only matches an option that says exactly "No".
- **Integrity test:** a synonym that would mean two different answers for the same question fails `tests/choices.test.ts`.
- **Tests:** add a case to `tests/choices.test.ts` with the real option text, and say which form uses that wording.
- **New answers:** adding a new code (a new answer) also adds it to the options-page dropdown automatically.

## Add a dictionary pattern

Field matching lives in `src/background/resolver/dictionary.ts`.

- **`FIELD_PATTERNS`** (Tier 2): regexes per key.
  - **Order matters:** the first key that matches wins, so specific keys come first. Question keys come before address keys.
  - Patterns run on **normalized** text (`normalizeForMatching` in `tier-dictionary.ts`): lowercase, camelCase split, `_ - . [ ] ( ) : * ✱` turned into spaces. Use `\b` word boundaries.
- **`KEY_EXCLUSIONS`:** wording where a key's word means something else ("please *state*", "*current* salary", "relocation *assistance*").
- **`PROSE_KEYS`:** keys whose patterns are specific enough to match long question text around a field.
- **`NEGATIVE_CONTEXT`:** "someone else's details" (referrer, company…). Question keys are exempt.
- **`FUZZY_SYNONYMS`** (Tier 4): phrases for word-overlap matching. Keep them specific; a bare "url" or "name" re-creates false positives.
- **`AUTOCOMPLETE_MAP`** (Tier 1): browser-standard `autocomplete` tokens.

Every change needs unit tests in `tests/resolver.test.ts` (or `fuzzy.test.ts` / `profile-keys.test.ts`), with both the case it fixes and a case it must *not* match.

## Learned answers ("Teach this")

`src/background/storage/learned-store.ts` holds two maps with two lookup paths. Keep them separate:
- **`answers`** (question → answer): read by resolver Tier 3, `src/background/resolver/tier-learned.ts`.
- **`optionSynonyms`** (key → option text → choice code): sent as `learnedOptions` by `fill-plan.ts`, and tried by the dropdown and radio fillers through `matchChoice` in `src/content/filler/option-match.ts`.

Learned text must never be logged, and the full store must never go to a content script. Only the options page reads it (`GET_LEARNED`).

## Fill event sequence

Text fields and dropdowns are filled with a fixed sequence of calls and events (`src/content/filler/event-sequence.ts`), not a bare value assignment:

- **Text:** `focus()` → native value setter → `focus` → `focusin` → `keydown` → `input` → `keyup` → `change` → `blur()` → `blur` → `focusout`.
- **Dropdowns:** `focus()` → `option.selected` + `selectedIndex` + native `value` setter → `focus` → `focusin` → `mousedown` → `mouseup` → `click` (on the option) → `click` → `input` → `change` → `blur()` → `blur` → `focusout`.

Why it matters:
- **Frameworks listen for different things.** React reads `input`, and `change` on selects. Form libraries often commit a value to their own state only on blur, validate on `keyup`, or mark fields "touched" on focus. Firing only `input` + `change` let a page *show* a value while its state stayed empty, and the form submitted the field blank.
- **`focusin`/`focusout` must be dispatched by hand.** React's `onFocus`/`onBlur` use them. The popup holds keyboard focus during a fill, and in a page without focus `element.focus()`/`blur()` fire nothing.
- **The native value setter** bypasses React's wrapped `value` setter; otherwise React ignores the `input` event.

Rules when changing it:
- **The order is tested:** `tests/robust-fill.test.ts` (the sequence) and the `robust-fill` browser suite (what the page receives, plus React state read on submit). Change both together.
- **Check the result, not the events.** The verification pass (`verify.ts`) re-reads each field 200 ms after filling and reports "page reverted". Don't weaken it to make a site pass.
- **Never log values.** The dev diagnostics log step names only, not the value or the key typed.

## Add a site adapter (planned)

Site adapters (Tier 5) don't exist yet; see [ROADMAP.md](ROADMAP.md). The intended shape, so early work stays consistent:

- **One file per site** in `src/background/resolver/adapters/<site>.ts`, exporting a pure tier function: `(field: FieldCandidate, profile: Profile) => ResolvedField | null`.
- **Running order:** adapters run in `TIERS` in `src/background/resolver/field-resolver.ts`, only for their site, and only where the generic tiers fall short.
- **Evidence:** record why the adapter matched, like the other tiers.
- **Tests:** a fixture page in `test-page/` reproducing the site's markup *structure* with our own content (no copies of real postings), plus unit tests and an E2E check.

Until then, the most useful contribution for a site is a bug report with the dev-build console tables.

## Conventions

- **TypeScript:** strict mode, no `any` without a comment explaining why.
- **Files:** small, under about 200 lines where reasonable.
- **Comments:** explain *why*, not *what*.
- **Dependencies:** none beyond React and Vite without a strong reason. Dependency versions are pinned exactly. The current exceptions are `pdfjs-dist` and `mammoth`, which read resume text locally and load only on the options page.
- **Fixture pages:** declare expected results on each control (`data-expect-*`).
- **Docs:** `README.md` (user-facing) and `ROADMAP.md` are the living docs. Note user-visible changes under `[Unreleased]` in `CHANGELOG.md`. Scratch notes (`prompt.md`, `todo.md`, `scratch*.md`, `*.local.md`) are git-ignored and aren't specs.
