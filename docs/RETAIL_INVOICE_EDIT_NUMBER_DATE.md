# Retail invoice editing, numbering and date display

This change is limited to Retail Sales. It does not deploy Firebase or alter other modules, monetary calculations, fish defaults, or the Print/PDF/Share mechanisms.

## Invoice identity and edit window

- A new invoice uses the business date selected before checkout. Its number is `DDMMYYYY` plus a daily sequence padded to at least three digits. The prefix is the selected, initially saved business date, not the device clock's date.
- Once saved, `businessDate`, `dateSortKey`, `invoiceNumber`, `invoiceSequence`, `createdAt` and `createdBy` are immutable.
- Firestore Rules permit edits only when `createdAt <= request.time < createdAt + 72 hours`. Exactly 72 hours is locked. Changing the invoice date or device clock cannot extend the server-enforced period.
- The UI uses the stored timestamp for the edit affordance, refreshes at its deadline and on foreground return, and fails closed when that timestamp is unavailable. The device clock is a display hint; Rules are the final authority.
- Vendor, fish items and their Chinese/Malay snapshots, weight, unit price and invoice remark can be edited. Amounts still use the existing integer-cent calculation. Remarks allow up to 500 characters.
- Each accepted edit updates the same invoice document, increments `revision`, and sets `updatedBy` / `updatedAt`. Print, PDF and Share remain available after expiry.
- Changing an invoice snapshot never writes back to Retail Master Data.

## Atomic numbering and audit

- `retailInvoiceCounters/{YYYYMMDD}` stores `dateSortKey`, `lastSequence`, `lastSaleId`, `updatedBy` and `updatedAt`.
- Creation reads the counter in a Firestore transaction and commits the increment, the complete invoice header, and its immutable create action together. No invoice count query is used. Contending transactions retry against the updated counter.
- The first sequence is 1; formatting produces 001, 002, ... 999, 1000. Each business date has its own counter.
- Rules require counter changes to accompany the corresponding new invoice and require invoice creation to accompany its counter and audit action. Counters cannot be reset, skipped or hard-deleted by a client.
- `retailSales/{saleId}/actions/{operationId}` follows the existing audit convention: action type, actor, server timestamp, client operation ID, revision, and exact before/after snapshots. Actions cannot be changed or deleted.
- Existing five-line immutable preparation groups are retained to stay within Rules evaluation limits for 20-line invoices. Creation uses the original four group IDs. Edits prepare four new groups prefixed by the operation ID. Preparation documents alone never appear as invoices or affect counters/history totals.
- The final edit transaction commits the new complete header and audit together. A failed preparation or final transaction leaves the prior invoice intact; no partial invoice or revision is published. Unreferenced preparation groups may remain after an abandoned attempt, following the existing preparation design.
- Both checkout and edit use a stable operation ID for retries. A committed action is verified before returning success; a lost response cannot allocate another number or increment the revision again. An edit checks the expected revision before and inside its final transaction, so a stale device must reload instead of overwriting another edit.

## Legacy records and compatibility

- There is no date migration and no historical renumbering. Old invoices without `invoiceNumber` continue displaying their original document ID.
- An eligible legacy invoice with a trusted `createdAt` may be edited without adding a number. Missing legacy `revision` means revision 1 for the first edit, which saves revision 2. Its raw original snapshot is retained in the audit.
- Existing integer-kg snapshots still normalize in memory through the established parser. Existing preparation groups are never overwritten; a pending old checkout can finish through the new counter/audit protocol.
- New invoice creation now requires the numbering/audit protocol. Any future release must publish the reviewed Rules and Hosting together in the established order; old open clients may need to reload before saving. This task itself does not deploy.

## Display dates and output

- `src/lib/retailDate.ts` provides the shared Retail-only formatter: `08092026 星期二 Tue`.
- Weekdays are derived from the civil business date, independently of device timezone. Audit timestamps retain the existing Malaysia timezone and HH:mm precision.
- New-sale and range pickers, Today/Week/Range headings, history rows, detail/edit views, invoice preview, Print and PDF use that formatter. The native date picker still handles selection; the surrounding displayed value is formatted consistently.
- Internal `DD/MM/YYYY` business dates, `YYYYMMDD` sort keys and Firestore timestamps stay unchanged. No shared ERP date formatter or other module is changed.
- PDF content/filename/title use the new date display and invoice number; optional remarks wrap using the existing renderer. Native print, prepared PDF File, file sharing, and open/download fallback paths are retained.

## Verification and release status

Regression coverage includes first/second/next-day numbering, concurrent allocation, transaction failure/retry, immutable identity, 72-hour boundary, stale-edit conflicts, legacy handling, audit snapshots, date/weekdays, history refresh, and unchanged calculations and Print/PDF/Share paths.

Local full quality gate: `node --check eslint.config.js`, typecheck, lint, **488/488 app tests in 46 files**, and build pass. The pre-existing AuthProvider Fast Refresh warning and build chunk-size warning remain unchanged.

Rules compile/Emulator: **30/30 tests pass**, including two independent concurrent clients receiving different numbers, next-day reset, 999→1000, all 20 lines on create/edit, server-time expiry and forged identity/audit rejection. Estimated executable Rules size is **253,860 bytes** (CI budget 253,952; runtime cap 256,000). Changes remain within the Retail Rules block.

## Changed files

- Routing/UI: `src/App.tsx` (Retail edit route only), `src/pages/RetailSalesPage.tsx`, `src/pages/retailSales.css`.
- Persistence/model: `src/services/retailSales.ts`, `src/lib/retailSales.ts`, new `src/lib/retailInvoice.ts`.
- Display/output: new `src/lib/retailDate.ts`, `src/components/RetailReceipt.tsx`, `src/lib/retailInvoicePdf.ts`.
- Security: Retail-only functions and matches in `firestore.rules`.
- Tests: `src/services/retailSales.test.ts`, `src/lib/retailInvoice.test.ts`, `src/lib/retailDate.test.ts`, `src/components/RetailReceipt.test.tsx`, `src/lib/retailInvoicePdf.test.ts`, `src/pages/RetailSalesPage.test.tsx`, `src/pages/RetailHistoryPage.test.tsx`, new `src/pages/RetailEditPage.test.tsx`, and Retail cases in `src/firestore.rules.test.ts`.
- Documentation: this file.

This branch is prepared for review only. No merge or production deployment is included in this task. Physical iPhone Safari acceptance remains separate from local browser layout checks.
