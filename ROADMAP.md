# Roadmap

What's planned, what's deferred, and why. Released changes are in [CHANGELOG.md](CHANGELOG.md).

## Done

- **Phase 1:** the expanded profile (salary, notice period, work eligibility, EEO) and native `<select>` filling with synonym matching.
- **Phase 2: radio buttons.** Each group is one question, matched on its question text, answered with a real `.click()` and re-checked after 100 ms.
- **Phase 3: learning system ("Teach this").** Details below, under Next, kept for the design record.
- **Phase 4: resume upload.** Built on branch `phase4-resume`, pending manual verification and merge.
  - One PDF/DOCX resume (5 MB max), stored in `chrome.storage.local` with the profile's access level; IndexedDB wasn't needed (5 MB is ~6.7 MB as base64, inside the 10 MB quota).
  - Plain text extracted once at upload with PDF.js and mammoth, capped at 20,000 characters, for Phase 7.
  - Attached to `type="file"` inputs that resolve to the new `resume` key, through `DataTransfer` plus `input`/`change`, verified after 100 ms. Always reviewed, never auto-dismissed.

## Next

Prioritized, not started.

1. **Phase 3: learning system ("Teach this").** *Done; kept here as the design record.* Matching against a fixed synonym table will always be inconsistent, because every application system words the same question differently. Let the user teach the right answer once, and reuse it.
   - **When:** a dropdown or radio group fails to match ("no option matched" / "multiple matches"), or a field resolves to `unknown`. The overlay offers a small **Teach this** action for that field.
   - **What the user does:** picks the right answer once.
   - **What's saved:** `{ normalized question text → chosen answer }`, in `chrome.storage.local`, locked to extension contexts like the profile. Nothing leaves the device.
   - **How it's used:** two maps, two lookup paths.
     - Answers to custom questions are checked by **Tier 3 (learned)**, after the dictionary and before fuzzy matching (tiers are now numbered by run order). A taught answer beats a guess but never overrides an explicit dictionary match.
     - Option wordings for known questions (a veteran dropdown worded unusually) are tried by the dropdown and radio fillers after the built-in synonyms.
   - **Managing it:** an options-page section to view, edit and delete learned answers (and delete them all).
   - **Safeguards:** learned answers fill only visible fields like everything else; their text is never logged; sizes and entry counts are capped; the overlay only accepts real clicks (`isTrusted`), so a page can't trigger "Teach" itself.
   - **Out of scope for this phase:** cloud sync, sharing answers between users, and learning without an explicit user action.
2. **Phase 5: type-to-search widgets.** Examples: Lever's "Current location", Ashby's country picker. They need per-widget interaction (type, wait for suggestions, pick one); setting a value isn't enough. They also need a location key in the profile.
3. **Iframe support, same-origin first (iCIMS), cross-origin later (embedded Greenhouse).**
   - **What we saw on iCIMS:**
     - The application form renders inside a same-origin iframe, so the scanner never sees it. The dev log correctly reports "14 iframe(s) on this page were not scanned".
     - The only controls found in the top document were OneTrust cookie widgets (`ot-group-id-*`, `vendor-search-handler`), correctly skipped as "not rendered".
     - Field IDs use dot notation: `PersonProfileFields.*`.
   - **Same-origin frames:** inject into all frames, scan and fill per frame, and allow subframe messages in the service worker's guard (it accepts the top frame only today). The click's `activeTab` grant may already cover same-origin frames; that needs confirming. Add dictionary coverage for `PersonProfileFields.*`.
   - **Cross-origin frames:** need a per-site permission prompt (optional host permissions). That's a permission-design decision.
   - The overlay must know which frame each row belongs to.
4. **Phase 7: AI answer drafting (optional, the user's own API key).** Drafts answers for open-ended questions, using the resume's stored `extractedText` as context. Only after explicit opt-in and consent; the key and the text go only to the provider the user picks.
5. **Phase 7b: AI resume suggestions.** Optional suggestions for improving the resume against a job description, under the same opt-in and own-key rules as Phase 7. Suggestions only: the stored file is never rewritten.

## Later

Known, lower priority.

- **Checkboxes** ("check all that apply"): different group semantics from radios, so they need their own design.
- **Clearing a radio answer on Undo.** No user action can un-select a radio, so React-style forms never see a programmatic clear. Undo leaves those answers in place and says so. A reliable clear would need per-framework handling.

- **Workday multi-page flows:** custom widgets plus step navigation; likely needs a site adapter.
- **Multi-language forms:** the dictionary, synonyms and choices are English-only.
- **Site-specific adapters for smaller application systems:** one small file per site, used only where the generic tiers fall short. (Tier 5; they were "Tier 4" before the learned tier was added.)
- **Multiple resumes** (e.g. one per kind of role), with a choice per application. Phase 4 stores exactly one.
- **Resume tailoring per job.**
- **Structured resume parsing** (name, experience, education as separate fields). Phase 7 prep.
- **Cover letter uploads.** File fields mentioning a cover letter are deliberately left alone today.
- **Fuzzy lookup of learned answers:** reuse a taught answer when a question is worded *almost* the same. Phase 3 starts with exact matches on normalized text.

## Out of scope

Won't do.

- **Any server-side component.** The extension is local-first: no account, no sync, no backend.
- **An "AI included" premium tier.** It would need a proxy, billing and a server. The optional AI fallback will only ever use the user's own API key, with explicit consent.
- **Telemetry or analytics.** No usage data, no error reporting, no phone-home. Any future error reporting would have to be opt-in, and is not planned.
- **Syncing or sharing learned answers.** No cloud sync, and no sharing answers between users. Learned answers stay on the device that learned them.
- **Full resume rewriting or layout-preserving edits.** A separate project, not happening here.
- **Learning without the user asking.** The extension never records an answer on its own; every learned answer comes from an explicit "Teach this".
