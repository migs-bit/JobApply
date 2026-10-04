# Roadmap

What's planned, what's deferred, and why. Released changes are in [CHANGELOG.md](CHANGELOG.md).

## In progress

- **Phase 1 is done:** the expanded profile (salary, notice period, work eligibility, EEO) and native `<select>` filling with synonym matching.
- **Radio buttons are next** (see below).

## Next

Prioritized, not started.

1. **Radio button support.** Lever and Ashby EEO sections and many custom Yes/No questions use radios, which are skipped today.
   - A radio group is several inputs sharing one `name`; the resolver must treat the group as one question.
   - The filler must call `.click()` on the correct radio rather than setting `.checked`, because React-controlled radios only update on a real click event.
   - Reuse the choice synonyms in `src/shared/choices.ts` to pick the radio by its label.
2. **Type-to-search widgets.** Examples: Lever's "Current location", Ashby's country picker. They need per-widget interaction (type, wait for suggestions, pick one); setting a value isn't enough. They also need a location key in the profile.
3. **Iframe support, same-origin first (iCIMS), cross-origin later (embedded Greenhouse).**
   - **What we saw on iCIMS:**
     - The application form renders inside a same-origin iframe, so the scanner never sees it. The dev log correctly reports "14 iframe(s) on this page were not scanned".
     - The only controls found in the top document were OneTrust cookie widgets (`ot-group-id-*`, `vendor-search-handler`), correctly skipped as "not rendered".
     - Field IDs use dot notation: `PersonProfileFields.*`.
   - **Same-origin frames:** inject into all frames, scan and fill per frame, and allow subframe messages in the service worker's guard (it accepts the top frame only today). The click's `activeTab` grant may already cover same-origin frames; that needs confirming. Add dictionary coverage for `PersonProfileFields.*`.
   - **Cross-origin frames:** need a per-site permission prompt (optional host permissions). That's a permission-design decision.
   - The overlay must know which frame each row belongs to.
4. **Resume file upload.** Store a resume locally and attach it to file inputs. Chrome restricts setting file inputs programmatically, so this needs research.
5. **Answer library.** Learn answers to custom questions, stored locally: one normalized question hash → one saved answer. Offered for review, never auto-submitted.

## Later

Known, lower priority.

- **Workday multi-page flows:** custom widgets plus step navigation; likely needs a site adapter.
- **Multi-language forms:** the dictionary, synonyms and choices are English-only.
- **Site-specific adapters for smaller application systems** (Tier 4): one small file per site, used only where the generic tiers fall short.

## Out of scope

Won't do.

- **Any server-side component.** The extension is local-first: no account, no sync, no backend.
- **An "AI included" premium tier.** It would need a proxy, billing and a server. The optional AI fallback will only ever use the user's own API key, with explicit consent.
- **Telemetry or analytics.** No usage data, no error reporting, no phone-home. Any future error reporting would have to be opt-in, and is not planned.
