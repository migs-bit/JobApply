# Job Application Autofill Extension — Project Brief

## What we're building

A Chrome extension (Manifest V3) that autofills job application forms.

**Design principles (in priority order):**
1. **Local-first.** Everything works offline, on-device, with zero API calls by default.
2. **Heuristics before AI.** Use deterministic matching (autocomplete attributes, label dictionaries, fuzzy matching) for ~90% of fields. AI is a last-resort fallback for weird/custom fields only.
3. **BYO API key.** The extension never owns an API key. Users supply their own. The developer pays $0 for usage, ever. No backend, no proxy, no billing.
4. **Graceful degradation.** If no API key is configured, the AI tier is skipped and the extension still works. If an API call fails, that one field is skipped — the extension never breaks.
5. **Open source from day one.** MIT or Apache 2.0. No telemetry, no analytics, no phone-home. State this explicitly.
6. **Testable and debuggable.** Deterministic for the common case. We should be able to explain *why* every field mapped to a value.

## Non-goals (for now)

- No backend server.
- No "AI included" premium tier (that requires a proxy + billing — separate project).
- No site-specific adapters in the MVP (add later, one at a time).
- No iframe / shadow DOM support in the MVP.
- No file upload (resume) in the MVP — text fields only.
- No cover letter / custom question generation in the MVP.

---

## Architecture: the tiered field resolver

Every field passes through tiers in order. First match wins. Each tier is free unless noted.

```
For each detected field:
  Tier 1: autocomplete attribute       → free, ~60-70% hit rate
  Tier 2: label/name dictionary regex  → free, +20%
  Tier 3: fuzzy match vs profile keys  → free, +5%
  Tier 4: site adapter override        → free (later, per-site)
  Tier 5: AI fallback (BYO key)        → optional, costs the USER, skipped if no key
  Fallback: flag as unknown → overlay shows it for manual entry
```

The resolver returns `{ key, confidence, source }` where `source` is which tier matched. This makes debugging trivial.

### Provider interface (for Tier 5, later)

```ts
interface ClassifierProvider {
  name: string;
  isConfigured(): Promise<boolean>;
  classify(fields: FieldCandidate[]): Promise<JevClassification[]>;
}

// Implementations (only NoOp in MVP):
class NoOpProvider implements ClassifierProvider { ... } // always returns unknowns
// class JevProvider implements ClassifierProvider { ... }     // later
// class OpenAIProvider implements ClassifierProvider { ... }  // later
// class GeminiProvider implements ClassifierProvider { ... }  // later
```

The resolver picks the first configured provider. In the MVP, only `NoOpProvider` exists, so Tier 5 is effectively disabled.

---

## MVP scope (what to build now)

**In scope:**
- Chrome extension, Manifest V3, TypeScript, Vite.
- Content script that scans the current page for `<input>` and `<textarea>`.
- Tier 1–3 resolver (autocomplete + dictionary + fuzzy).
- React-safe DOM filler (works with React-controlled inputs).
- Options page (React) to enter and save a user profile to `chrome.storage.local`.
- Small overlay showing what was filled, with per-field confidence and source.
- Popup with a "Fill this page" button.
- Zero network calls. Zero API keys. Fully offline.

**Out of scope for MVP:**
- Tiers 4 and 5.
- Iframes, shadow DOM.
- File uploads.
- Custom question answering.
- Site-specific adapters.
- Multi-language forms.

---

## File structure to generate

```
job-autofill-extension/
├── manifest.json
├── package.json
├── tsconfig.json
├── vite.config.ts
├── README.md
├── src/
│   ├── background/
│   │   ├── service-worker.ts
│   │   └── storage/
│   │       └── profile-store.ts
│   ├── content/
│   │   ├── content-script.ts
│   │   ├── scanner/
│   │   │   └── dom-scanner.ts
│   │   ├── resolver/
│   │   │   ├── field-resolver.ts        # orchestrates tiers 1-3
│   │   │   ├── tier-autocomplete.ts
│   │   │   ├── tier-dictionary.ts
│   │   │   ├── tier-fuzzy.ts
│   │   │   └── dictionary.ts            # the pattern table
│   │   ├── filler/
│   │   │   └── dom-filler.ts            # includes setNativeValue helper
│   │   └── overlay/
│   │       └── confirmation-ui.ts
│   ├── options/
│   │   ├── options.html
│   │   └── options.tsx
│   ├── popup/
│   │   ├── popup.html
│   │   └── popup.tsx
│   └── shared/
│       ├── types.ts
│       └── constants.ts
```

---

## Key interfaces

```ts
// shared/types.ts

export interface Profile {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  linkedin: string;
  github: string;
  website: string;
  // extendable — resolver treats missing keys as "no match"
}

export interface FieldCandidate {
  id: string;              // stable id, e.g. hash of selector
  selector: string;        // CSS selector to re-find the element
  tag: "input" | "textarea" | "select";
  type: string;            // input type attribute
  name: string;
  autocomplete: string;
  label: string;           // <label> text if found
  placeholder: string;
  ariaLabel: string;
  nearbyText: string;      // text in the surrounding container
}

export interface ResolvedField {
  fieldId: string;
  key: keyof Profile | "unknown";
  confidence: number;      // 0-1
  source: "autocomplete" | "dictionary" | "fuzzy" | "ai" | "none";
}

export interface FillInstruction {
  selector: string;
  value: string;
  confidence: number;
  source: ResolvedField["source"];
  requiresReview: boolean; // true if confidence < threshold
}
```

---

## Dictionary design (Tier 2)

A single file, `dictionary.ts`, exporting a map from canonical profile keys to arrays of regex patterns. Order matters — more specific patterns first.

```ts
export const FIELD_PATTERNS: Record<string, RegExp[]> = {
  firstName:     [/first[\s_-]?name/i, /\bgiven[\s_-]?name\b/i, /^fname$/i],
  lastName:      [/last[\s_-]?name/i,  /\bfamily[\s_-]?name\b/i, /^lname$/i],
  email:         [/e[\s_-]?mail/i],
  phone:         [/phone|mobile|cell|telephone|\btel\b/i],
  addressLine1:  [/address[\s_-]?line[\s_-]?1/i, /^address$|^street/i],
  addressLine2:  [/address[\s_-]?line[\s_-]?2/i, /apt|suite|unit/i],
  city:          [/\bcity\b|town/i],
  state:         [/\bstate\b|province|region/i],
  postalCode:    [/zip|postal/i],
  country:       [/\bcountry\b/i],
  linkedin:      [/linked[\s_-]?in/i],
  github:        [/git[\s_-]?hub/i],
  website:       [/website|portfolio|personal[\s_-]?site|\burl\b/i],
};

// Browser-standard autocomplete tokens → canonical keys (Tier 1)
export const AUTOCOMPLETE_MAP: Record<string, keyof Profile> = {
  "given-name":        "firstName",
  "family-name":       "lastName",
  "email":             "email",
  "tel":               "phone",
  "tel-national":      "phone",
  "address-line1":     "addressLine1",
  "address-line2":     "addressLine2",
  "address-level2":    "city",
  "address-level1":    "state",
  "postal-code":       "postalCode",
  "country":           "country",
  "country-name":      "country",
  "url":               "website",
};
```

**Confidence scoring per tier:**
- Tier 1 (autocomplete): `1.0`
- Tier 2 (dictionary): `0.9` if the pattern matches the `name` or `label` exactly; `0.7` if it matches `placeholder` or `nearbyText`.
- Tier 3 (fuzzy): proportional to similarity score (see below). Only accept if ≥ `0.6`.

---

## Fuzzy matching (Tier 3)

Use token-set similarity against the profile keys and their synonyms. A simple approach:

1. Normalize: lowercase, strip punctuation, split into tokens.
2. Build a set of tokens from the field's `label + name + placeholder + ariaLabel`.
3. For each candidate key, compute Jaccard similarity between the field tokens and the key's synonym tokens.
4. Pick the highest-scoring key. If ≥ 0.6, accept with that confidence.

No external dependency required — implement Jaccard or Levenshtein inline (~30 lines).

---

## React-safe DOM filling

This is critical. React (and Vue, and many frameworks) hijack `input.value`, so simply setting it does nothing. Use the native setter + dispatch events:

```ts
export function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event("input",  { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}
```

Also: skip fields that are hidden, disabled, read-only, or already non-empty (unless the user explicitly asks to overwrite).

---

## Message passing (content ↔ background)

Only a few message types needed in the MVP:

```ts
type Msg =
  | { type: "GET_PROFILE" }
  | { type: "SET_PROFILE"; profile: Profile }
  | { type: "RESOLVE_FIELDS"; fields: FieldCandidate[] }; // resolver runs in background
```

Why resolve in background? Because when Tier 5 (AI) is added later, network calls must happen there (content scripts have CORS limitations and are sandboxed from some APIs). Keep the resolver in the background from day one so adding AI later is a one-file change.

---

## Options page

Simple React form with all fields in `Profile`. On save → `chrome.storage.local.set({ profile })`. Show a small "AI Fallback (optional)" section that is **disabled/greyed out in the MVP** with a note: *"Coming later. Bring your own API key."*

This reserves the UX space so adding BYO-key later is not a redesign.

---

## Popup

One button: **"Fill this page"**. On click, send a message to the active tab's content script to run the scan → resolve → fill flow. Show a small status line: "Filled 12 of 14 fields. 2 need review."

---

## Overlay / confirmation UI

A minimal floating panel (shadow DOM to avoid style collisions) that:
- Lists each field, its resolved value, confidence, and source tier.
- Highlights low-confidence fields in yellow.
- Has "Undo" (restore previous values) and "Close" buttons.
- Auto-dismisses after a few seconds if everything is high-confidence.

---

## Privacy rules (enforce in code)

- Never log profile values to console in production builds.
- Never send profile data anywhere in the MVP (there is no network code at all).
- When Tier 5 is added later: show a one-time consent prompt before the first AI call, explain what gets sent, and store the consent flag in `chrome.storage.local`.
- No telemetry, no analytics, no error reporting to a server. If you add error reporting later, it must be opt-in.

---

## README must state

- This extension is local-first. No data leaves your device in the default configuration.
- AI fallback is optional and requires your own API key (coming later).
- The developer receives no data and pays for no API usage.
- MIT (or Apache 2.0) licensed.
- How to contribute site adapters (once that system exists).

---

## Build order (do these in sequence)

1. `manifest.json`, `package.json`, `tsconfig.json`, `vite.config.ts` — get a blank extension loading in Chrome.
2. `shared/types.ts`, `shared/constants.ts`.
3. `background/storage/profile-store.ts` + `background/service-worker.ts` (message router only, no logic yet).
4. `options/` page — get profile save/load working end to end.
5. `content/scanner/dom-scanner.ts` — log detected fields to console; verify on a real job site.
6. `content/resolver/dictionary.ts` + `tier-autocomplete.ts` + `tier-dictionary.ts` + `field-resolver.ts` — log resolutions to console.
7. `content/filler/dom-filler.ts` — fill fields, including React-safe setter.
8. `popup/` — wire the "Fill this page" button.
9. `content/overlay/confirmation-ui.ts` — show results.
10. `tier-fuzzy.ts` — add the third tier last.

Do not skip step 5. Verify the scanner on 3–4 real job applications before writing any resolver logic. The scanner is where 80% of bugs live.

---

## Style / quality bar

- TypeScript strict mode on.
- No `any` unless justified with a comment.
- Small files (< 200 lines each where reasonable).
- Every tier function is pure and unit-testable: `(field: FieldCandidate, profile: Profile) => ResolvedField | null`.
- Comments explain *why*, not *what*.
- No dependencies beyond React + Vite unless clearly justified.

---

## What I want you to produce

Generate the full MVP as described above. Start with steps 1–4 of the build order in your first pass, then check in with me before continuing to the scanner and resolver. Include a short `README.md`.

Use placeholders for anything you don't know (e.g., icons). Do not add any API code, any network code, or any API key handling — that's explicitly out of scope for the MVP.

--2nd input newest input--

---

## Addendum: Step 4 Check-In Answers & Step 5 Instructions

**Status:** Steps 1–4 are verified. The extension loads in Chrome, the options page saves and reloads the profile, the service worker runs without errors, and permissions are storage-only. (Note: Chrome's Details page shows no permissions because `storage` is a silent permission — confirmed granted via `chrome.permissions.getAll()`.) This addendum answers the open check-in questions and unblocks step 5.

### Answers to the Step 4 Check-In

1. **Resolver location:** `src/background/resolver/` — following the brief's own reasoning that adding AI later should be a one-file change.
2. **Test sites:** Lever and Ashby. Testing will happen on real postings manually after the build. **Skip Greenhouse** for now since it embeds its form in an iframe, which the MVP does not scan.
3. **Popup permissions:** On-click `activeTab` + `scripting` injection. No host permissions. No "read all data on all websites" warning.
4. **Commit:** Yes — commit steps 1–4 to `MVPv1`, including `Brief.md`.

### Note on the Popup

Clicking the toolbar icon only flashes — no panel opens. On `chrome://extensions` → Details → **Inspect views**, the only entries are `service worker` and `options/options.html`. This means `popup.html` is not registered in the manifest or is not being built by Vite.

**This is acceptable for now.** Fold the popup into step 8 as planned. When step 8 begins:

- Add `src/popup/popup.html`
- Register it in the manifest as `action.default_popup: "popup.html"`
- Add it to `rollupOptions.input` in `vite.config.ts`
- Wire the "Fill this page" button to the content-script injection

Do not fix the popup before step 8.

### Proceed to Step 5: The DOM Scanner

**Goal:** A generic scanner that finds form fields on any page, with no site-specific logic.

**Files to create:**

- `src/content/scanner/dom-scanner.ts` — the scanner itself
- `src/content/content-script.ts` — a minimal entry point that runs the scanner and logs results

**Scanner requirements:**

- Walk the DOM and find `<input>`, `<textarea>`, and `<select>` elements.
- For each element, extract a `FieldCandidate` matching the interface in `shared/types.ts`:
  - `id`
  - `selector` (stable and unique — prefer `#id` if present, otherwise build a CSS path)
  - `tag`
  - `type`
  - `name`
  - `autocomplete`
  - `label` (resolve from, in order: explicit `<label for="...">`, wrapping `<label>`, `aria-labelledby`; fall back to empty string)
  - `placeholder`
  - `ariaLabel`
  - `nearbyText` (trimmed text content of the closest reasonable container — parent `<div>` or `<fieldset>` — capped to a reasonable length)
- **Skip** fields that are:
  - `type="hidden"`, `type="submit"`, `type="button"`, `type="reset"`
  - `disabled`
  - `readonly`
  - `display: none` or `visibility: hidden`

**Content script requirements:**

- Runs the scanner on page load.
- Logs detected fields to the console using the existing `debug()` helper (so output is silent in production builds).
- Does nothing else — no resolver, no filler, no overlay.

**Manifest registration:**

- Because we're using `activeTab` + `scripting`, the content script must be injected **programmatically** (when the popup calls it), not declared in `content_scripts`.
- If this conflicts with the current build setup, pause and explain the conflict before building.

### Stop Conditions

- **Do not** build the resolver, filler, overlay, or popup yet.
- **Stop after step 5** and check in. The scanner will be tested on real Lever and Ashby postings, and any failures will be reported back with specific console output.
- Keep the build clean: strict TypeScript, no `any`, no new dependencies, no network code.

--end of newest input--
