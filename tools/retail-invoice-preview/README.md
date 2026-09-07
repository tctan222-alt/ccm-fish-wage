# Retail invoice iPhone acceptance preview

This local tool renders the **same** `RetailReceipt` and `RetailReceiptActions` used by Retail Sales, with the production styles and a Vite production build. It supplies two fixed sample invoices: a normal two-line invoice and a 20-line invoice with long Chinese/Malay names and large values. It does not import the application router, authentication, Firebase, services, or production records. The server also sets `connect-src 'none'` so the preview cannot make application network calls.

Nothing here deploys, saves a sale, changes Master Data, installs certificate trust, or changes firewall rules. The production build does not include this preview entry point.

## Diagnosis and verification limits

At base commit `e30b41ca96524ba42a105438d82e15e3a6ffbaf2`, checkout and history receipts already called `window.print()` directly inside their click handlers. No iframe, timer, popup or asynchronous work preceded printing, and the existing print CSS hid the navigation/actions. Code inspection did not establish why the owner's iPhone Print sheet failed; that remains an explicit device acceptance item.

Retail had no PDF generation, PDF File, download or Web Share implementation. The new output path prepares a real PDF File when the receipt loads, then calls `navigator.share` synchronously from the user's click after checking `navigator.canShare({ files })`. [WebKit documents the user activation lifetime](https://webkit.org/blog/13862/the-user-activation-api/). Unsupported sharing and actual errors expose open/download options. Cancellation is not an error.

The jsPDF generator embeds locally rendered 192 dpi A4 canvas images so Chinese and Malay names need no network fonts. The PDF is a valid PDF document, but its text is not selectable/searchable. Stored invoice names, weights, prices, line amounts and total are formatted without recalculating or changing sales data. Only output components and receipt integration change in the ERP.

Automated validation covers PDF signature/MIME/File/name, pagination, immutable amounts, direct share/print invocation, cancellation, error/fallback states, stale preparation, URL lifetime and print isolation. The full application suite passes 379 tests; typecheck, lint and build pass (existing AuthProvider fast-refresh and large main-bundle warnings remain). The local server has five passing boundary checks. Native-canvas PDFs were separately parsed and visually checked: the short sample has one page and the long sample has four, with the final total visible. Desktop narrow-viewport checks and these tests do not prove iPhone AirPrint, Share Sheet or PDF viewer behavior.

Keep the branch and PR unmerged and do not deploy until the owner completes the device checks below. This preview never replaces that acceptance.

## Build and local desktop check

From the repository directory in PowerShell, after normal dependencies are installed:

```powershell
npx.cmd vite build --config tools/retail-invoice-preview/vite.config.ts
node tools/retail-invoice-preview/server.mjs --http
```

Open `http://127.0.0.1:8788/retail-sales`. The build output goes into the ignored `node_modules/.cache/retail-invoice-preview` directory. Rebuild after changing receipt code. This is a static production build, with no HMR or service worker. The server defaults to loopback and plain HTTP is restricted to loopback. Desktop checks do **not** establish iPhone AirPrint or Share Sheet acceptance.

Server boundary checks:

```powershell
node --test tools/retail-invoice-preview/server.check.mjs
npx.cmd tsc --project tools/retail-invoice-preview/tsconfig.json --pretty false
```

## Same-Wi-Fi iPhone HTTPS setup

Web Share is a secure-context API. An iPhone opening a computer's `http://192.168.…` address does not meet that requirement. A trusted local HTTPS certificate is needed to test file sharing on the same Wi-Fi without deploying or opening a public tunnel.

**Ask the owner to approve this temporary certificate/trust and LAN preview setup before executing it or asking them to install trust.** Do not install a root certificate or change a firewall silently. If the owner does not accept local certificate trust, stop the iPhone file-share acceptance setup and report that a trusted HTTPS preview address is still needed.

After approval, find the computer's active Wi-Fi IPv4 address and substitute it for `192.168.1.123` below. Certificate generation requires Python with `cryptography`; it uses no network. This Codex workstation already has that library in its bundled Python runtime. Do not install another dependency without checking the available runtime first.

```powershell
python tools/retail-invoice-preview/create-local-certificate.py --ip 192.168.1.123
node tools/retail-invoice-preview/server.mjs --host 192.168.1.123 --certificate-port 8789
```

The default HTTPS port is 8788. The optional HTTP port 8789 serves **only** `/ccm-retail-preview-ca.cer`, the public test CA. It cannot serve the invoice, source files, private key, or arbitrary files. The HTTPS server serves only the compiled fixture page and its assets. It does not expose the certificate directory.

The generated certificate expires after seven days. The CA signing key exists only during generation and is never saved. The server key, certificate and public CA are stored in ignored `.local-https/`. Never commit them. Generation refuses to overwrite existing certificates. A changed Wi-Fi IP requires a new certificate matching that IP.

On the owner's iPhone, after they approve installing this short-lived local test CA:

1. Open `http://192.168.1.123:8789/ccm-retail-preview-ca.cer` in **Safari** and allow the certificate profile to download.
2. Open **Settings → General → VPN & Device Management**, select the downloaded **CCM Retail local preview** profile and install it. Check that its name/expiry matches the local certificate output.
3. Open **Settings → General → About → Certificate Trust Settings** and enable full trust for this specific **CCM Retail local preview** certificate. Installing the profile alone does not enable TLS trust. [Apple's certificate trust instructions](https://support.apple.com/en-gb/102390).
4. Open `https://192.168.1.123:8788/retail-sales` in Safari. It must load without a certificate warning and show **安全连接：已启用**. Do not treat bypassing a certificate warning as successful HTTPS acceptance.

If Safari cannot connect, confirm the PC and iPhone use the same Wi-Fi and the server is listening on the displayed address. Do not disable the firewall or open permissions automatically; ask the owner about any required network permission. A certificate setup blocked by device management must not be bypassed.

## iPhone acceptance

Use the ordinary two-line invoice first, then repeat with the long invoice:

1. Tap **打印**. Confirm the actual iOS Print sheet appears, choose an available AirPrint printer and inspect the invoice preview. Only the invoice should print; preview settings and action buttons must be hidden. Check Chinese/Malay names, kg, RM/kg, totals, long rows and page breaks.
2. Tap **PDF / 分享** after the PDF is ready. Confirm the actual iOS Share Sheet appears. Use **Save to Files**, open that saved PDF and inspect its pages. If WhatsApp is installed, confirm it is offered; sending to another person remains the owner's choice.
3. Cancel the Share Sheet once and confirm no error is shown. Return to the invoice and retry to verify the action still works.
4. Tap **其他 PDF 选项** to reveal **打开 PDF** / **下载 PDF**, open the PDF and verify its content actually displays. Confirm the downloaded file ends in `.pdf` and opens from Files. Browsers without file-sharing support show these options after **PDF / 分享** automatically; do not infer success from button clicks alone.
5. Record iPhone model, iOS version, Safari version where available, Print sheet result, PDF display result and Share Sheet / Save to Files result. Preserve failures for diagnosis; automated mocks or a desktop browser do not replace these checks.

After acceptance, stop the local server and remove the **CCM Retail local preview** profile from **Settings → General → VPN & Device Management**. Verify it no longer appears in Certificate Trust Settings. Remove only the generated `.local-https/` files after the server is stopped; do not modify other certificates.
