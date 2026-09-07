# Retail Sales history and labels — 2026-09-07

Scope: first-entry history loading, bilingual fixed UI copy, and the invoice title.
No changes to calculations, prices, stored fields, write operations, Rules, print CSS,
PDF generation/sharing mechanisms, or other modules' behavior. No deployment.

## History diagnosis and fix

The list lives at `/retail-sales/history`. The `/retail-sales` page links to it.
Previously, the history effect called `loadRetailSales()` / `getDocs()` once per
date and displayed loading until its Promise settled. Firebase's installed SDK
waits for online synchronization before delivering cached query results through
`getDocs`. The one-shot result also cannot update after later server data arrives.
Re-entering the page restarts that read, which can mask the original wait.

The auth gate already waits for `onAuthStateChanged`. The history query does not
depend on the entry form or vendor search. No evidence supported changing auth,
adding a delay, or adding a form dependency. A regression test reproduced cached
rows remaining invisible while the initial one-shot read was unresolved. The
precise production transport trigger has not been captured on the user's iPhone;
this diagnosis establishes the first-read synchronization weakness in the code.

History now uses a date-scoped `onSnapshot` subscription with metadata updates:

- Available cached rows display immediately and identify themselves as cached.
- An empty cache is described as awaiting server data, not confirmed no sales.
- Server data and confirmed empty results arrive through the same subscription.
- Query/setup/mapping errors stop loading and show bilingual errors and Retry.
- Date changes and unmount cancel the old subscription and ignore stale callbacks.
- Vendor filtering stays local and does not restart the query.
- No timer, navigation, refresh, or new production write is used for recovery.

## Bilingual fixed labels

User-entered names and stored fish snapshots are data, not translated labels.
The exact invoice title is the explicit exception to bilingual headings.

| Area | Labels |
| --- | --- |
| Navigation | 门市销售 Retail Sales; 现金销售 Cash Sales; 销售历史 Sales History; 鱼名与建议价 Fish and Suggested Prices; 返回 Back; 退出登录 Sign Out |
| Entry | 日期 Date; 小贩 Vendor; 鱼名 Fish; 重量 Weight (kg); 单价 Unit Price (RM/kg); 本行金额 Line Amount; 本单明细 Items; 本次现金合计 Cash Total |
| Entry actions | 加入明细 Add Item; 清除当前品名 Clear Fish; 移除 Remove; 结算 Checkout; 重试结算 Retry Checkout; 下一位小贩 Next Vendor |
| Fish picker | 鱼名建议 Fish Suggestions; 新增 Add; 新增门市鱼种 Add Retail Fish; 新鱼马来文名 New Fish Malay Name; 新鱼建议单价 New Fish Suggested Price (RM/kg); 保存并使用新鱼 Save and Use Fish; 取消新增 Cancel Add |
| Retail fish settings | 新增鱼种 Add Fish; 修改鱼种 Edit Fish; 中文鱼名 Chinese Fish Name; 马来文名（可空） Malay Name (Optional); 建议单价（可空） Suggested Price (RM/kg, Optional); 启用 Active; 停用 Inactive; 保存鱼种 Save Fish; 取消 Cancel; 建立初始三种鱼 Create Three Starter Fish |
| History | 搜索小贩 Search Vendor; 合计 Total; 项 Items; 查看并打印 View / Print; 重试 Retry; 缓存 Cached; loading, confirmed empty, cache wait and query errors |
| Invoice | 日期 Date; 小贩 Vendor; 结算时间 Checkout Time; 单号 Invoice No.; 鱼名 Fish; 重量 Weight (kg); 单价 Unit Price (RM/kg); 金额 Amount (RM); 现金合计 Cash Total; 内部 / 门市现金结算单 Internal Cash Invoice |
| Output actions | 打印 Print; PDF / 分享 PDF / Share; 其他 PDF 选项 More PDF Options; 打开 PDF Open PDF; 下载 PDF Download PDF; 重新生成 PDF Regenerate PDF |

Placeholders, validation/help text, loading/saving/sharing notices, fallback
messages and unsaved-change confirmation also use Chinese followed by English.
The PDF's existing fixed price column uses the shorter `单价 Price/kg` header.
No remark field was added; the existing Retail model has no remark input.

## Invoice title

Preview, print content and every PDF page: `门市现金结算单`.
The share title is `门市现金结算单 · <vendor>`; PDF metadata uses the same title
with its business date. Files are named `门市现金结算单-DD-MM-YYYY-<vendor>.pdf`.
These output titles and filenames no longer contain `CCM Fishery` or `CCM`.
Native print, prepared PDF File sharing, open/download and URL lifetime logic
are unchanged.

## Verification

- Added 8 page/auth lifecycle regression tests and 6 history service tests.
- Full app suite: 393/393 passed across 41 files.
- Typecheck and build passed; lint passed with the existing AuthProvider warning.
- Existing print, file-share/fallback/error and calculation tests passed.
- Generated real PDFs with the current generator: ordinary invoice 1 page,
  long invoice 4 pages; rendered and inspected all pages for title/table clipping.
- Local invoice preview at an observed 375 px width: bilingual labels present,
  with no horizontal page overflow for ordinary and long fixtures.
- Local fixtures do not connect to Firebase or create production records.
- Production iPhone verification of the history fix remains pending a future,
  separately authorized release. This work does not claim new AirPrint/Share Sheet
  device acceptance or change those mechanisms.

## Changed files

Runtime: `src/pages/RetailSalesPage.tsx`, `src/services/retailSales.ts`,
`src/components/RetailFishPicker.tsx`, `src/components/RetailReceipt.tsx`,
`src/lib/retailInvoicePdf.ts`, `src/lib/retailSales.ts`, `src/App.tsx`,
`src/components/BackButton.tsx` (last two only change text on Retail routes).

Tests: `src/pages/RetailHistoryPage.test.tsx`,
`src/services/retailHistoryLoading.test.ts`, `src/pages/RetailSalesPage.test.tsx`,
`src/components/RetailReceipt.test.tsx`, `src/lib/retailInvoicePdf.test.ts`.

Documentation: this file.
