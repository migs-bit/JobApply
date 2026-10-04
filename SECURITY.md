# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Report them privately using GitHub's "Report a vulnerability" button on the repository's **Security** tab.

Include steps to reproduce and the Chrome version. We aim to respond within 7 days.

## How the extension handles your data

- **No network access.** There is no network code. The extension pages' Content Security Policy (`default-src 'none'`) blocks requests as a backstop, and the E2E suite proves it with a canary server that must receive nothing.
- **Local storage only.** The profile lives in `chrome.storage.local`, restricted to the extension's own pages and service worker; web pages and content scripts can't read it.
- **Least data to the page.** A web page only receives the values for fields actually being filled. The popup never holds profile data.
- **Hidden fields are never filled.** That includes transparent, clipped, 1px and off-screen fields, which are a known autofill-phishing technique.

### Logging policy

| Build | What is logged |
|---|---|
| **Production** (`npm run build`) | **No debug logging.** The only console output is an error message when something fails (a fill, a message, a storage call), and it never includes profile data. |
| **Development** (`npm run dev`) | Diagnostics for debugging matching. It includes field labels and other page text, the field a value was matched to, and **for dropdowns, the text of the option that was chosen**. |

**Text-field values are never logged in any build:** not your name, email, phone, address, links, salary, or notice period. The E2E suites check this on every run.

The chosen dropdown option *is* page text, but for EEO or eligibility questions it reveals your answer, such as "Decline to self-identify". Treat dev-build console output as personal data, and don't paste it publicly without redacting it.

## Scope

In scope:

- Any way for a web page to read profile data or influence what the extension stores.
- Any network request made by the extension.
- Anything that bypasses the extension's Content Security Policy.
- Any filled value reaching a field the user can't see.
- Any profile text value appearing in console output.

Out of scope:

- Issues that require an already-compromised browser or machine.
- Information in dev-build logs that the logging policy above says is logged.
