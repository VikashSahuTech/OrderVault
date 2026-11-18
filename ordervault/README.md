# OrderVault — local-first Gmail order tracker

OrderVault is a browser-based PWA prototype. It requests **Gmail read-only** access, scans marketplace-related emails in the browser, extracts basic order details, groups messages by detected order ID, and saves the resulting records in IndexedDB on that browser/device.

## Important limitations (read before connecting Gmail)

- This is a **working starter/prototype**, not a production-grade marketplace integration.
- Amazon, Flipkart and Myntra email templates change. The parser uses heuristics; it will miss or misclassify some messages. Review the results.
- Emails do not reliably contain live courier events, refund-credit confirmation, or every historical order. The app cannot guarantee complete order coverage.
- Gmail search is capped at 1,500 matching messages per sync in this version.
- Each browser/device has its own local database. It does not sync PC and mobile data. Export/import JSON to move a backup.
- Gmail access tokens are held in memory only and are not written to local storage. Order records are stored locally in IndexedDB. Browser extensions, malware, shared computer profiles, and browser data loss remain risks.
- Google may show an unverified-app warning while your OAuth app is in Testing. Add your own Google account as a test user. Public use of restricted Gmail scopes can require Google verification and potentially a security assessment.
- Do not deploy this publicly as a multi-user product without a proper security, privacy, and Google OAuth review.

## Requirements

- Node.js 20.19+ or 22.12+ recommended
- npm
- A Google account with Gmail

## 1. Create Google OAuth credentials

1. Open https://console.cloud.google.com/ and create a project, e.g. `OrderVault`.
2. Open **APIs & Services → Library** and enable **Gmail API**.
3. Open **Google Auth Platform → Branding** and configure the app name, support email and developer contact email.
4. Open **Google Auth Platform → Audience**. Choose **External** if this is a personal Gmail account. Keep it in **Testing** and add your own Gmail address under **Test users**.
5. Open **Google Auth Platform → Clients → Create client**.
6. Choose **Web application**.
7. Under **Authorized JavaScript origins**, add:
   - `http://localhost:5173`
   - If you later host the app, add its exact HTTPS origin, e.g. `https://your-domain.example`
8. Create the client and copy the **Client ID**. A browser SPA does not use a client secret. Never add a client secret to this project.
9. Under **Data Access**, the app requests only `https://www.googleapis.com/auth/gmail.readonly`.

Google documentation:
- Gmail API: https://developers.google.com/workspace/gmail/api
- Gmail list messages: https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list
- Gmail get message: https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/get
- Google Identity Services: https://developers.google.com/identity/oauth2/web/guides/overview

## 2. Configure the app

From this folder:

```bash
npm install
```

Copy `.env.example` to `.env` and replace the placeholder:

```env
VITE_GOOGLE_CLIENT_ID=123456789-your-client-id.apps.googleusercontent.com
```

Then run:

```bash
npm run dev
```

Open **http://localhost:5173**. Use the **Connect / sync Gmail** button and approve the Gmail read-only permission.

If you change `.env`, stop and restart `npm run dev`.

## 3. Build for production

```bash
npm run build
npm run preview
```

For installation as a PWA, deploy the `dist/` folder to a static host that serves HTTPS. Add that exact HTTPS origin to the OAuth client's Authorized JavaScript origins. On desktop Chrome, use the install icon in the address bar. On iPhone, open the HTTPS site in Safari → Share → Add to Home Screen.

For mobile access, the app must be hosted on HTTPS. `localhost` is only for development on the same device.

## 4. Data and privacy

- Order records: IndexedDB database `ordervault-local`, object store `orders`.
- Last-sync timestamp: browser localStorage.
- Access token: memory only; re-authorise when needed.
- Export: JSON file from the dashboard.
- Import: select a previous OrderVault JSON backup.
- Delete: Setup & privacy → Delete local orders.
- Disconnect/revoke: visit https://myaccount.google.com/permissions and remove OrderVault's access. Clearing the browser's site data also removes local order data.

The app loads Google Identity Services from Google's CDN and Google Fonts from fonts.googleapis.com. Gmail API requests go directly from the browser to Google. No OrderVault backend is included.

## Known parser behaviour

The parser tries to identify marketplace from sender/subject/body, order IDs, first rupee amount, a product-like subject, and status keywords. It merges messages only when the same store and order ID are extracted. This means:
- An email with no parseable order ID may appear as a separate order.
- An incorrect ID can merge unrelated emails or split one order into multiple rows.
- Refunds and returns are represented as one broad status; the app does not yet reconcile bank credits.
- Product titles and amounts need manual review.

## Troubleshooting

- **Origin not allowed**: add `http://localhost:5173` to Authorized JavaScript origins.
- **Access blocked / app not verified**: ensure your account is listed as a test user while the OAuth app is in Testing.
- **Gmail API has not been used**: enable Gmail API in the same Cloud project as the OAuth client.
- **Google library did not load**: check internet access and reload.
- **No orders found**: search Gmail manually for Amazon/Flipkart/Myntra order emails. The first version's sender and subject query/parser is intentionally conservative; not every seller or notification sender is recognised.
- **Local orders missing on another device**: expected. Use Export on one device and Import on the other.

## Roadmap

1. Better marketplace-specific parsers with sample email fixtures.
2. Manual editing and order detail view.
3. More accurate event timeline and tracking-number extraction.
4. Optional carrier tracking integrations.
5. Optional encrypted user-controlled sync, only if you later want cross-device sync.
