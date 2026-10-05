# Phase 2: Radio Button Support

## Context (read this first)

The MVP is done. Phase 1 (expanded profile keys + native `<select>` dropdown filling) is done and committed on `post-mvp`. A local security review just ran and came back clean — no network calls, no `eval`, no `innerHTML`, minimal permissions.

The next phase is radio button support. Currently every radio input is skipped with the reason `type="radio" is not filled by the MVP`. This means yes/no questions, some EEO sections, and most custom card questions on Lever/Ashby stay empty.

## Why this is harder than native selects

A native `<select>` is one input. A radio group is **multiple inputs sharing one name** — three, four, sometimes eight radios that together represent one question. Setting `.checked = true` on the right one is not enough: React-controlled radios need a real `.click()` event to update their state. Setting the property directly gets reverted on the next render.

So the resolver and the filler both need new logic:

- **Resolver:** recognize a group of radios as one question, produce one match per group
- **Filler:** find the correct radio in the group and `.click()` it

## Requirements

### 1. Group detection (scanner)

- Find `<input type="radio">` elements that share a `name` attribute
- Treat the group as one logical field
- The group's "label" is the question text near the group (the text above or beside the radios as a set)
- Each radio's own label is its option text (e.g. "Yes", "No", "Male", "Female")
- The group's "options" are the list of radio labels
- Report the group in the scan output so diagnostics show it as one field, not five

### 2. Resolution (resolver)

- Reuse the existing dictionary and synonym machinery, but match against the **group's question text** rather than individual radio labels
- Do not match a single radio like "Yes" against `workAuthorization: yes` — that would match every Yes/No group on the page
- Only resolve the group when the **question text** clearly maps to a known key
- **Field-type limits:** radios can only resolve to keys where a yes/no or multiple-choice answer makes sense (workAuthorization, requiresSponsorship, willingToRelocate, gender, race, veteranStatus, disabilityStatus)

### 3. Answer selection (choice matching)

- Given a resolved key and the saved profile value, pick which radio to click
- Use the existing synonym tables in `shared/choices.ts`
- Normalize before matching (same rules as select option matching)
- If multiple radios match one synonym → skip with reason "multiple matches"
- If no radio matches → skip with reason "no option matched" + list available options

### 4. Filling (dom-filler)

- Use `.click()` — not `.checked = true` — because React requires the event
- Before clicking, verify the radio is visible, enabled, and not already selected
- Verify after a short delay (100ms) that the radio is actually checked
- If the page reverted it, report `failed — page reverted`
- Record which radio was clicked so Undo can restore the previous selection (if any)

### 5. Undo

- Undo must restore the previously-selected radio in the group, or clear the selection if nothing was selected before
- Same "only revert what we wrote" rule as the text and select fillers

### 6. Diagnostics

- In dev builds, log one row per radio group (not per radio)
- Include: resolved key, chosen radio label, status, reason
- If skipped: "no option matched" + available radio labels
- Same output format as the select diagnostics

### 7. Sensitive answers

- EEO, sponsorship, relocation, work authorization: always flag for review (yellow row in overlay, no auto-dismiss)
- Same behavior as the existing sensitive-answer handling

## Explicitly out of scope

- Checkboxes (different group semantics, "check all that apply" questions)
- File uploads (needs DataTransfer)
- Type-to-search widgets (Lever location, Ashby country picker)
- iframe/iCIMS support
- Custom React dropdowns

Do not touch any of these.

## Testing

1. **Unit tests:**
   - Group detection (multiple radios with one name → one field)
   - Resolution against question text (not radio label)
   - Synonym matching for yes/no and multiple choice
   - Field-type limits (radio can't resolve to email or phone)
   - Ambiguous case (two radios in a group both match one synonym → skip)
   - No-match case (no radio text matches any synonym → skip)

2. **Browser tests:**
   - Local fixture with several radio groups (yes/no, EEO gender, EEO race, veteran status)
   - React fixture with a controlled radio group — verify `.click()` sticks and the component state updates
   - Live Lever form (WISEcode posting) — fill a custom yes/no question if present
   - Undo restores previous selection
   - Sensitive answers flagged yellow
   - No profile values appear in console logs

3. **Regression:**
   - All existing tests still pass (radio changes must not break text or select filling)
   - Gender, race, veteran dropdowns still fill on the live Lever form

## Report back in this format

When done, write a report structured exactly like the codebase review you gave me earlier:

**One line summary** — what changed, what's next.

**What each new or changed file does** — one paragraph per file, same tone as the review. Include the new files (e.g. `scanner/radio-group.ts`, `filler/radio-filler.ts`) and any files you modified.

**Test results** — table: suite / result / notes.

**Known gaps** — anything you deliberately didn't handle, with reason.

**What I should verify manually** — the specific things I need to check in Chrome to confirm it works.

**Stop conditions** — do not start checkboxes, file uploads, or type-to-search. Stop after radio support and check in.

## Output format for the report

- Short paragraphs, not walls of text
- Bullet lists over prose
- Tables for test results
- Bold the file names and key findings
- No code dumps in the report — reference files by path and line if needed