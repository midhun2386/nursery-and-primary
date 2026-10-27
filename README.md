# WonderSprout — Setup Guide
**Files:** `Code.gs` (backend), `index.html`, `styles.css`, `app.js` (frontend). Placeholders to replace: `PASTE_YOUR_SPREADSHEET_ID`, `PASTE_WEB_APP_URL`, `PHONE_NUMBER`, `[SCHOOL ...]`.

## Deploy
1. Create a Google Sheet; copy the ID from its URL (`/d/<ID>/edit`). Keep it **private**; share only with staff.
2. Sheet → Extensions → Apps Script. Paste `Code.gs`.
3. Edit the `CONFIG` block: spreadsheet ID, `NOTIFY_EMAIL`, `NOTIFY_ENABLED`, programs, length limits.
4. Run `setup` once and approve permissions (Sheets, Mail, Cache/Properties). Tabs and headers appear.
5. Deploy → New deployment → Web app. **Execute as: Me** (the school account; visitors never get sheet access). **Who has access: Anyone** (required for a public form). Copy the `/exec` URL.
6. Put the URL in `app.js` (`API_URL`). Host the 3 frontend files (GitHub Pages, Netlify, school hosting; HTTPS).
7. After **every** code change: Deploy → Manage deployments → Edit → New version. The URL stays the same.

## Why this integration works (CORS)
Apps Script cannot answer CORS preflight (`OPTIONS`), and `application/json` triggers one. So `app.js` sends the JSON as **`text/plain`**, a "simple request" with no preflight. Apps Script answers with a redirect to `script.googleusercontent.com`; `fetch` follows it and that response is readable cross-origin, so the page can confirm real success. A `no-cors` fetch would hide the response and could never prove the save happened; this code does not use it. Test from a hosted page or `localhost`, not `file://`.

## Security & privacy
- No endpoint reads records; `doGet` is a health check. The sheet ID lives only in server code.
- Server validates everything, caps lengths, rejects oversized bodies, neutralizes formulas, uses a honeypot field and 5 submissions/hour/phone, and logs no personal data.
- Consent is mandatory. For deletion requests, find the row (by Submission ID) and delete it; also review sheet sharing yearly.
- Not a guarantee of security or legal compliance (GDPR, India's DPDP Act, etc.). Have the school review its obligations, especially for children's data.
- Quotas apply (e.g. ~100 emails/day on free accounts, daily script runtime limits, 30 concurrent executions). Lock waits can fail under extreme bursts; users see an error and keep their data.

## Tests (expected result → verify)
| Case | Expected | Verify |
|---|---|---|
| Valid admission / enquiry | Green "Thank you + ID"; form resets | New row in the right tab, status `New` |
| Missing fields, bad email/phone | Red message; form keeps data | No new row |
| Message >1000 chars | Rejected | No row |
| Double-click submit | One request only (button disabled) | One row |
| Spreadsheet permission failure (wrong ID) | Generic server error, data kept | Apps Script → Executions log |
| Email failure (bad address) | Success still shown (`emailSent:false`) | Row exists; log shows `Email failed` |
| Simultaneous submissions | Unique, sequential IDs | Open two tabs, submit together |
| Offline | "Network problem" message; data kept | Disable network in DevTools |
| Formula injection (`=1+1` as name) | Stored as text `'=1+1` | Cell shows text |

## Troubleshooting
Authorization errors → re-run `setup`. Old behavior after edits → you forgot a **new version**. CORS error → access not set to "Anyone", or you used `application/json`. HTML login page returned → deployment not public.
