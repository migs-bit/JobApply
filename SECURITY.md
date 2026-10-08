# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Report them privately using GitHub's "Report a vulnerability" button on the repository's **Security** tab.

Include steps to reproduce and the Chrome version. We aim to respond within 7 days.

## How the extension handles your data

- **No network access.** There is no network code. The extension pages' Content Security Policy (`default-src 'none'`) blocks requests as a backstop, and the E2E suite proves it with a canary server that must receive nothing.
- **Local storage only.** The profile lives in `chrome.storage.local`, restricted to the extension's own pages and service worker; web pages and content scripts can't read it.
- **Least data to the page.** A web page only receives the values for fields actually being filled. The popup never holds profile data.
- **Learned answers ("Teach this") get the same protections as the profile.**
  - They're stored in locked-down local storage, tied to question or option text only; no site or URL is kept.
  - A page only ever receives the learned answer for a field being filled. The full set goes only to the options page.
  - Teach reads the value of the one field it was clicked for, and only on a real (trusted) click.
- **The resume gets the same protections as the profile.**
  - It's stored in the same locked-down local storage, as `{ filename, mimeType, size, base64, extractedText, uploadedAt }`. No site or URL is kept.
  - Its text is extracted once, at upload, on the options page. PDF.js and mammoth are bundled into the extension; the PDF.js worker loads from the extension itself, and the CSP still blocks every network request.
  - The service worker re-checks every upload on the decoded bytes: 5 MB limit, PDF or DOCX only, and contents must match the extension (a renamed image is rejected).
  - A page receives the file only when one of its fields resolved to `resume`. It never receives the extracted text, which nothing reads yet (it's kept for the planned opt-in AI tier).
  - It's attached only to file inputs whose label matches a resume, never to ones mentioning a cover letter, portfolio, writing sample or transcript. A file the user attached is never replaced.
- **Hidden fields are never filled.** That includes transparent, clipped, 1px and off-screen fields, which are a known autofill-phishing technique.
  - Exception: a file input counts as visible when the label or upload button wrapped around it is. Sites nearly always hide the native file input behind their own button. A file input with no visible label or button is never touched.

### Logging policy

| Build | What is logged |
|---|---|
| **Production** (`npm run build`) | **No debug logging.** The only console output is an error message when something fails (a fill, a message, a storage call), and it never includes profile data. |
| **Development** (`npm run dev`) | Diagnostics for debugging matching. It includes field labels and other page text, the field a value was matched to, and **for dropdowns, the text of the option that was chosen**. |

**Text-field values are never logged in any build:** not your name, email, phone, address, links, salary, notice period, or answers you taught. The resume's contents and extracted text are never logged either. The E2E suites check this on every run.

The chosen dropdown option *is* page text, but for EEO or eligibility questions it reveals your answer, such as "Decline to self-identify". Treat dev-build console output as personal data, and don't paste it publicly without redacting it.

## Scope

In scope:

- Any way for a web page to read profile data or influence what the extension stores.
- Any network request made by the extension.
- Anything that bypasses the extension's Content Security Policy.
- Any filled value reaching a field the user can't see.
- Any profile text value or learned answer appearing in console output.
- Any way for a page to trigger "Teach this" or Undo, or to read learned answers it isn't filling.
- Any way for a page to obtain the resume without a resume field being filled, to obtain its extracted text, or to get it attached to a non-resume or invisible field.
- A malicious PDF or DOCX file that escapes the extraction libraries or breaks the CSP.

Out of scope:

- Issues that require an already-compromised browser or machine.
- Information in dev-build logs that the logging policy above says is logged.
