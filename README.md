# Job Autofill

A Chrome extension (Manifest V3) that autofills job application forms from a profile you keep on your own device.

- **Local-first.** No data leaves your device in the default configuration. The extension makes no network requests at all: there is no network code, and its Content Security Policy blocks network access as a backstop.
- **No telemetry.** No analytics, no error reporting, and no phone-home.
- **AI is optional (coming later).** A future AI fallback for unusual fields will require **your own** API key and your explicit consent before first use.
- **The developer receives no data and pays for no API usage.** There is no backend.
- **Open source**, [MIT licensed](LICENSE).

> **Status: early MVP.** Build steps 1–4 are done: the extension shell, profile storage, and the options page. Scanning and filling forms comes next.

## How it works

Every detected form field goes through deterministic tiers. The first match wins, and each fill records which tier matched, so you can always see *why* a field got a value:

1. **Tier 1:** the `autocomplete` attribute.
2. **Tier 2:** label and `name` dictionary patterns.
3. **Tier 3:** fuzzy matching against profile keys.
4. **Tier 4 (later):** site adapters.
5. **Tier 5 (later):** optional AI fallback with your own key.

Anything unmatched is left for you to fill in by hand.

## Install (development)

Requires Node 20+ and Chrome 120+.

```bash
npm ci
npm run build
```

1. Open `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked** and select the `dist/` folder.
3. The profile page opens automatically. Fill it in and click **Save**.

`npm run dev` rebuilds on change, with debug logging enabled. After each rebuild, click the reload icon on the extension's card.

## Security model

- **Minimal permissions.** The only permission is `storage`. There are no host permissions, so the extension cannot read any website until you invoke it.
- **Strict CSP on extension pages:** `default-src 'none'; script-src 'self'`. No inline scripts, no `eval`, and no network connections.
- **One trust boundary.** Only the service worker touches storage, and it validates every message:
  - It checks the message's shape and bounds its size.
  - Profile messages are accepted only from the extension's own pages. Content scripts, which run inside untrusted websites, can never read the full profile.
  - `chrome.storage.local` is restricted to trusted extension contexts.
- **Input sanitizing.** Profile values are stripped of control and bidi-override characters and length-capped. Link fields must be `http(s)` URLs.
- **Production builds never log profile data.** Debug logging is compiled out.
- **Supply chain.** Dependencies are pinned to exact versions, and `.npmrc` disables npm install scripts. The runtime dependencies are only React and React DOM.

To report a vulnerability, see [SECURITY.md](SECURITY.md).

## Contributing

Site adapters (Tier 4) will live in their own folder, one small file per site. Contribution guidelines will be added once that system exists. Until then, issues and PRs for the core tiers are welcome.

## License

MIT, see [LICENSE](LICENSE).
