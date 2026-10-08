# Super Mailer

**Super Mailer** is a Windows desktop application for legitimate, permission-based bulk email campaigns.
It extracts email addresses from documents you are authorised to process, lets you review and clean the
recipient list, composes a personalised campaign, and sends it through **your own authenticated SMTP account**
with a queue, rate limiting, retries, pause/resume/cancel and persistent history.

*created by aebraharm*

> Super Mailer is not a tool for unsolicited mail. Only send to people who opted in or have a legitimate
> relationship with you, and honour unsubscribe requests. Inbox placement is decided by each recipient's
> email provider; Super Mailer cannot guarantee it.

---

## Features

| Area | What it does |
| --- | --- |
| Splash & branding | Animated launch screen, deep-blue/white theme, toasts, progress rings, smooth view transitions. |
| Dashboard | Total / valid / invalid / duplicate counts, queued, sent, successful and failed sends, recipient health, recent campaigns. |
| Document extraction | PDF, DOCX, DOC (best effort), XLSX/XLSM/XLS, CSV, TXT, Markdown, HTML, XML, JSON, RTF. Select files, select a folder, or drag and drop. Runs in a worker thread; unreadable files are reported and skipped. |
| Normalisation | Lower-casing, wrapper stripping (`mailto:`, `<…>`), de-duplication across documents, malformed-address detection, source document kept per address. |
| Review Recipients | Search, filter (All / Valid / Invalid / Suppressed / Selected), sort, paginate, select / deselect, remove one / selected / invalid, add manually, CSV import and export. Nothing is sent from this screen. |
| Composer | Campaign name, sender name, reply-to, subject with personalisation chips, rich-text editor, plain-text fallback (auto or custom), sandboxed HTML preview, **Preview Email**, **Send Test Email**, List-Unsubscribe header. |
| Confirmation | Mandatory dialog: *"You are about to send this campaign to X recipients."* with an explicit opt-in checkbox. The main process re-checks the count before sending. |
| Sending queue | Configurable rate (messages/minute), single pooled SMTP connection, retries with backoff for temporary errors, no retries for permanent ones, connection/socket timeouts, automatic pause on authentication failure or repeated network failures, pause / resume / cancel, live progress. |
| Deliverability hygiene | STARTTLS or implicit TLS required by default with certificate verification, authenticated SMTP, Reply-To handling, List-Unsubscribe (one-click when HTTPS), permanent rejections auto-suppressed, suppression list management, rate limiting. No header forging, no spoofing, no concealment of infrastructure. |
| Settings | Sender name/email, Reply-To, SMTP host/port, encryption, username, password/API key (stored with Windows DPAPI), Test Connection with clear results, sending limits and retry policy. |
| Campaign history | Persistent list with date, recipients, sent, failed, status and duration; detail view with per-recipient results and filters. |

---

## Architecture

```
src/
├── main/                      Electron main process (Node.js)
│   ├── main.js                App lifecycle, window, security lock-down (CSP, permissions, sandbox)
│   ├── services.js            Composition root: creates and wires every service
│   ├── ipc/                   IPC layer
│   │   ├── register-handlers.js  Every channel the UI may call, with validation
│   │   ├── validators.js         Payload sanitisation, email-HTML sanitiser
│   │   └── path-guard.js         Only user-selected/dropped paths may be read
│   ├── workers/
│   │   └── extraction-worker.js  Parses one document at a time off the UI thread
│   └── modules/               Pure, unit-tested domain modules (no Electron imports)
│       ├── document-parser.js    Format dispatch and safe parsing (never throws)
│       ├── extraction-service.js Folder walk, worker orchestration, cross-document de-dupe
│       ├── email-utils.js        Extraction, normalisation, validation
│       ├── recipient-store.js    Recipient list, selection, filters, CSV import/export
│       ├── personalize.js        {{variable}} rendering with HTML escaping
│       ├── message-builder.js    Builds the MIME message per recipient
│       ├── send-queue.js         Queue: retries, pause/resume/cancel, auth & network handling
│       ├── rate-limiter.js       Even spacing of sends
│       ├── transport-smtp.js     nodemailer transport, TLS modes, error classification
│       ├── campaign-manager.js   Preflight, confirmation gate, sending lifecycle, history
│       ├── credential-manager.js Encrypted credential storage (safeStorage / DPAPI)
│       ├── settings.js           Non-secret settings
│       ├── history-store.js      Campaign history
│       ├── suppression-store.js  Permanently failed / unsubscribed addresses
│       └── logger.js             Leveled logging with secret redaction and rotation
├── preload/preload.js         contextBridge API: the only bridge between UI and main
└── renderer/                  UI (plain HTML/CSS/JS, no framework, no remote code)
    ├── index.html, css/app.css
    └── js/ui.js, app.js, views/*.js
```

Key design decisions:

* **No 1,000 parallel connections.** One pooled SMTP connection, a rate limiter that spaces sends, and a
  bounded retry policy. Campaign size is capped at 1,000 recipients in the main process.
* **The UI never touches the network or the disk directly.** It calls a narrow IPC API. The renderer runs with
  `contextIsolation`, `sandbox`, no Node integration, a strict Content-Security-Policy, and all permission
  requests denied.
* **Documents stay local.** Parsing happens in a worker; only email addresses and file names leave the worker.
  No document content is sent anywhere.
* **Credentials never sit in plaintext.** The SMTP password is encrypted with Electron's `safeStorage`
  (Windows DPAPI, bound to the user account). If encryption is unavailable, credentials are refused rather than
  stored in clear text. Credentials are never written to logs, history or settings files, and log lines are
  redacted.
* **Confirmation is enforced server-side.** `campaign:start` requires the exact recipient count the user saw
  and the sender configuration to pass preflight.
* **Permission-based by design.** Suppressed addresses are skipped, permanent rejections are suppressed
  automatically, and the UI requires an explicit opt-in confirmation before every send.

---

## Requirements

* Windows 10/11 (x64) for the installer. Development also works on macOS and Linux.
* Node.js 18 or newer (developed with Node 22).
* An SMTP account or transactional-email provider you are authorised to use, with your domain's SPF, DKIM and
  DMARC records configured by you.

## Development

```bash
npm install          # installs dependencies and downloads the Electron runtime
npm start            # launches Super Mailer
npm test             # unit + renderer + end-to-end tests (no network required)
npm run test:e2e     # local SMTP server end-to-end tests only
npm run icon         # regenerates assets/icon.png and assets/icon.ico
```

## Building for Windows

```bash
npm install
npm run icon         # optional: icons are already committed
npm run pack         # unpacked app in release/win-unpacked (development/production check)
npm run dist         # NSIS installer: release/Super-Mailer-Setup-1.0.0.exe
```

The installer is a normal per-user Windows installer with a Start Menu entry, desktop shortcut, and an
uninstaller. User data (settings, recipient list, history, encrypted credentials, logs) lives in
`%APPDATA%\Super Mailer`.

Run `npm run dist` on a Windows machine. The NSIS installer is produced by electron-builder and is intended to be
built on Windows.

## Using Super Mailer

1. **Settings** → enter sender name, sender email, SMTP host, port, encryption, username and password/API key →
   **Test Connection** → **Save changes**.
2. **Extract Emails** → drop or select documents you are authorised to process → **Extract emails**.
3. **Recipients** → review the list, fix or remove invalid addresses, select the people you intend to contact,
   then **Continue to Campaign**.
4. **Create Campaign** → write the message, use `{{first_name}}`, `{{last_name}}` and `{{email}}` as needed,
   **Preview Email**, **Send Test Email** to yourself, then **Review & send**.
5. Confirm the recipient count and tick the opt-in confirmation. The campaign then appears on **Live Campaign**
   with pause, resume and cancel controls.
6. **Campaign History** shows every campaign and each recipient's result.

### CSV import format

A header row is required. The email column may be named `email`, `email address`, `mail` or `address`.
Optional columns: `first_name` / `first name` / `given name`, `last_name` / `last name` / `surname`. Any other
columns are kept and can be used as personalisation variables.

```csv
email,first_name,last_name,company
ann@example.com,Ann,Lee,Acme
```

---

## Testing

`npm test` runs **94 automated tests**:

* **Unit (`tests/unit`)**: email extraction and validation, CSV parsing and export (including formula-injection
  protection), every supported document format plus corrupt, empty, missing and unsupported inputs, recipient
  store behaviour (duplicates, selection, filters, sorting, paging, CSV import/export, persistence), send queue
  (retries, backoff, permanent errors, pause/resume, cancel, auth pause, network auto-pause, concurrency),
  rate limiter, credential encryption (no plaintext on disk), settings clamping, history, suppression, SMTP
  error classification, transport options, message building and personalisation.
* **Extraction service**: real worker-thread processing of mixed formats, cross-document de-duplication,
  folder recursion, cancellation.
* **End-to-end (`tests/e2e`)**: a local SMTP server that enforces AUTH and rejects specific addresses. The tests
  exercise the real stack (campaign manager → queue → rate limiter → nodemailer → SMTP) and verify:
  personalised delivery with Reply-To and plain-text parts, the confirmation gate, wrong-password pausing,
  permanent rejection and suppression, temporary rejection and retry, test email, connection checks and
  unreachable-server handling.
* **Renderer (`tests/renderer`)**: loads the real `index.html` and UI scripts in jsdom with a stubbed bridge and
  walks every route, failing on any uncaught error.

## Known limitations

* **Windows build not verified in this environment.** The development sandbox used to build this version could
  not download the Electron binary, so the packaged app and the live Electron window were not launched here.
  The backend and the renderer are covered by the automated tests above; run `npm start` and `npm run dist` on
  Windows as the final check.
* **Legacy `.doc`** files are read on a best-effort basis by scanning the binary for text runs. Re-save as
  `.docx` for reliable results. Scanned PDFs without a text layer cannot be read.
* **Bounce handling** covers synchronous SMTP rejections (permanent failures are suppressed immediately).
  Asynchronous non-delivery reports that arrive later in your mailbox are not parsed; check your provider's
  bounce reports too.
* **Unsubscribe requests** received by email or through your website are not processed automatically. Add them
  to the suppression list in Settings. The List-Unsubscribe header is included so mail clients can show an
  unsubscribe option.
* **Sender reputation and authentication** (SPF, DKIM, DMARC) are configured in your DNS and by your provider.
  Super Mailer does not set them up for you.
* **Single account.** One sending account is configured at a time.
* **Single active campaign** at a time; campaigns still running when the app closes are marked *interrupted*
  in history and are not resumed automatically.

## Security notes

* Renderer: `contextIsolation`, `sandbox`, no Node integration, CSP with `connect-src 'none'`, navigation and
  popups blocked, all permission requests denied.
* IPC: every payload is validated; file reads are limited to paths chosen through a dialog or drag and drop;
  CSV imports are capped at 20 MB; documents over 200 MB are skipped.
* Email HTML is sanitised before sending: scripts, frames, objects, forms, inline event handlers and
  `javascript:` links are removed.
* Logs contain no document text or credentials; passwords, tokens and API keys are redacted before writing.
  Email addresses appear in logs for troubleshooting, so treat the log file as personal data.

## License

MIT. See [LICENSE](LICENSE).
