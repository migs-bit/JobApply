# Roadmap

What's planned, what's deferred, and why. Released changes are in [CHANGELOG.md](CHANGELOG.md).

## In progress

- **Phase 1 is done:** the expanded profile (salary, notice period, work eligibility, EEO) and native `<select>` filling with synonym matching.
- **Phase 2, radio buttons, is built** on branch `phase2-radio`, pending manual verification:
  - each group is one question, matched on its question text;
  - answered with a real `.click()`, re-checked after 100 ms;
  - one diagnostics row per group;
  - always flagged for review.

## Next

Prioritized, not started.

1. **Type-to-search widgets.** Examples: Lever's "Current location", Ashby's country picker. They need per-widget interaction (type, wait for suggestions, pick one); setting a value isn't enough. They also need a location key in the profile.
2. **Iframe support, same-origin first (iCIMS), cross-origin later (embedded Greenhouse).**
   - **What we saw on iCIMS:**
     - The application form renders inside a same-origin iframe, so the scanner never sees it. The dev log correctly reports "14 iframe(s) on this page were not scanned".
     - The only controls found in the top document were OneTrust cookie widgets (`ot-group-id-*`, `vendor-search-handler`), correctly skipped as "not rendered".
     - Field IDs use dot notation: `PersonProfileFields.*`.
   - **Same-origin frames:** inject into all frames, scan and fill per frame, and allow subframe messages in the service worker's guard (it accepts the top frame only today). The click's `activeTab` grant may already cover same-origin frames; that needs confirming. Add dictionary coverage for `PersonProfileFields.*`.
   - **Cross-origin frames:** need a per-site permission prompt (optional host permissions). That's a permission-design decision.
   - The overlay must know which frame each row belongs to.
3. **Resume file upload.** Store a resume locally and attach it to file inputs. Chrome restricts setting file inputs programmatically, so this needs research.
4. **Answer library.** Learn answers to custom questions, stored locally: one normalized question hash → one saved answer. Offered for review, never auto-submitted.

## Later

Known, lower priority.

- **Checkboxes** ("check all that apply"): different group semantics from radios, so they need their own design.
- **Clearing a radio answer on Undo.** No user action can un-select a radio, so React-style forms never see a programmatic clear. Undo leaves those answers in place and says so. A reliable clear would need per-framework handling.

- **Workday multi-page flows:** custom widgets plus step navigation; likely needs a site adapter.
- **Multi-language forms:** the dictionary, synonyms and choices are English-only.
- **Site-specific adapters for smaller application systems** (Tier 4): one small file per site, used only where the generic tiers fall short.

## Out of scope

Won't do.

- **Any server-side component.** The extension is local-first: no account, no sync, no backend.
- **An "AI included" premium tier.** It would need a proxy, billing and a server. The optional AI fallback will only ever use the user's own API key, with explicit consent.
- **Telemetry or analytics.** No usage data, no error reporting, no phone-home. Any future error reporting would have to be opt-in, and is not planned.
