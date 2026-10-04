# Project Context for Review

## What this project is (TL;DR)

A Chrome extension (Manifest V3, TypeScript) that autofills job application forms from a locally stored user profile. It scans the page, figures out which field is which, fills it in. No network calls. No servers. No API keys. Runs 100% on the user's machine.

## Why it exists

Job applications are repetitive. Same name, email, phone, resume, work authorization, EEO questions — over and over across different sites. This automates the boring parts so you only type what's actually unique per job.

## Core design principles (in priority order)

1. **Local-first.** Works offline. Nothing leaves the machine.
2. **Heuristics before AI.** Deterministic matching for ~90% of fields. AI is a fallback for weird fields only.
3. **BYO API key.** If AI is ever used, the user supplies their own key. Developer pays $0.
4. **Graceful degradation.** If any layer fails, the extension still works. It just skips that field.
5. **Explainable.** Every mapping records *why* it matched, not just the result.
6. **Testable.** Deterministic for the common case. Bugs are reproducible.

## How the field resolution works (tiered)

Fields are matched in order. First match wins. Each tier is more expensive than the last.

| Tier | Method | Cost | When it runs |
|---|---|---|---|
| 1 | `autocomplete` attribute | Free | Always first |
| 2 | Regex dictionary on label/name/placeholder | Free | If tier 1 misses |
| 3 | Fuzzy token match against profile keys | Free | If tier 2 misses |
| 4 | Site-specific adapter (not built yet) | Free | Future |
| 5 | AI fallback (BYO key) | Optional | Only if tiers 1–4 miss |
| — | Flag as unknown, show in overlay | Free | Final fallback |

## Why these choices (non-standard decisions explained)

### Why not use an AI model for everything?

Because 90% of job application fields are the same 30 questions across every site. Regex + a dictionary handles them instantly, deterministically, and for free. AI would be slower, cost money, and be less reproducible. AI is the *last* resort, not the first.

### Why not use Python?

Extensions run inside Chrome's sandbox. Chrome executes JavaScript/TypeScript, not Python. There's no interpreter and no workaround without a backend server — which we explicitly don't want.

### Why no backend?

A backend means infrastructure cost, a privacy surface, and a billing model. The entire point is that the developer pays $0 and no user data leaves the device. This is a hard constraint, not a preference.

### Why tiered resolution instead of one smart matcher?

- **Fast:** 90% of fields never need tier 3+
- **Cheap:** AI only fires on weird fields
- **Debuggable:** you can trace *why* a field matched
- **Testable:** deterministic for the common case
- **Private:** profile data rarely needs to leave the browser

### Why a dictionary of regex patterns?

Because field labels are surprisingly stable. "First name", "Email", "Phone", "LinkedIn URL" — same words on almost every site. 200 patterns cover 90% of what you'll ever see. It's boring but it works.

### Why synonyms for dropdown values?

Native `<select>` options vary by site. One site says "Male", another says "Man", another says "M". The profile stores a canonical value (`male`) and the code maps it to whatever the option text actually says. Exact-match alone fails constantly.

### Why fuzzy matching (tier 3) if the dictionary exists?

For weirdly-worded forms: "What should we call you?" → first name. "Best number to reach you" → phone. The dictionary can't anticipate every phrasing. Fuzzy catches the long tail without needing AI.

### Why not always overwrite existing values?

Because if you've already typed something into a field, the extension shouldn't clobber it. Safety rule: skip any field that already has a value. Same for hidden, disabled, or invisible fields — those are phishing vectors.

### Why no radios, checkboxes, or file uploads in the MVP?

Each is a different fill mechanism:
- **Radios:** need a real `.click()`, not `.checked = true` (React rejects the latter)
- **Checkboxes:** same issue, plus group semantics
- **File uploads:** need `DataTransfer` with a real file object
- **Type-to-search widgets:** aren't native `<select>` at all, they're divs pretending

These are real features, just scheduled later so the MVP ships and works.

### Why not support Workday / iCIMS / Greenhouse yet?

- **Workday:** multi-page, account-gated, iframe-heavy, custom widgets
- **iCIMS:** form inside a same-origin iframe
- **Greenhouse:** cross-origin iframe

Iframe support is a whole phase of work. The MVP targets single-page native forms (Lever, Ashby) because those are the most common and the easiest to do well.

## Project structure
