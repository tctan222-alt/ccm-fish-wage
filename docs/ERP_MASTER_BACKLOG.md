# ERP Master Backlog

Owner 已确认，2026-09-30。本文记录正式业务要求、执行顺序和交付状态；详细实现与验证放在各 focused PR。

## 执行约定

- 按 Priority 0–10 顺序推进，每个独立业务范围从最新 `main` 建立 focused branch / PR。完成一项、CI 全绿且 review 无 blocker，再进入下一项；不一次开发全部功能。
- 普通技术实现、测试和兼容修复自行处理；只有真实业务歧义、受保护权限或不可逆操作需要 Owner 决策。
- 不部署 feature branch，不运行 `firebase init`，不使用 Cloud Functions / Blaze，不 hard delete 生产历史，不写生产假业务记录。
- 合并前运行 `git diff --check`、typecheck、lint、tests、build。Rules 有变更时额外运行 compile、Emulator tests、size gate。
- 生产发布只能来自 reviewed、CI-passing、merged main；按 [测试与部署规范](TEST_AND_DEPLOY_RULES.md) 执行。
- 相关依据：[Baseline](CODEX_BASELINE.md)、[架构](ERP_ARCHITECTURE.md)、[采购规则](PURCHASE_RULES.md)、[工钱规则](WAGE_RULES.md)、[任务模板](CODEX_TASK_TEMPLATE.md)。本次 Owner 决策优先于相冲突的旧需求。

## 状态总览

| Priority | 业务范围 | 当前状态 / PR |
|---|---|---|
| 0 | 当前 main、PR、生产发布状态核对 | 已完成；详情见下 |
| 1 | Fish Head Purchase 立即输入 kg | 已合并 [PR #43](https://github.com/tctan222-alt/ccm-fish-wage/pull/43)，`49477b13b19468527e635c4007883e51e619b35e`；本地 482 tests / typecheck / lint / build、CI / review 通过；尚未部署 |
| 2 | 未完成称重实时价格与金额 | 已实现，[PR #44](https://github.com/tctan222-alt/ccm-fish-wage/pull/44)；本地 505 tests / typecheck / lint / build 通过，CI / review / 合并状态见 PR；尚未部署 |
| 3 | 未完成称重 entry 修改与即时重算 | 待开始 |
| 4 | Fish Head Settlement 待结单首页 | 待开始 |
| 5 | Settlement sourceSessionId identity | 待开始；解决 #37 P1 finding |
| 6 | Settlement stable revision read | 待开始；解决 #37 P2 finding |
| 7 | Settlement 筛选与历史查询 | 待开始 |
| 8 | 切鱼头工钱 Daily Details + Print | 待开始 |
| 9 | Retail Master Data 与 Owner seed dataset | 待开始；完整 dataset 必须先找回 |
| 10 | 更新 Retail invoice 编辑 / 编号 / 日期 | 待开始；[#36](https://github.com/tctan222-alt/ccm-fish-wage/pull/36) 保持 Draft，暂不合并 |

## Priority 0：真实状态核对

2026-09-30 已完成本轮起始核对和 housekeeping：

- [PR #39](https://github.com/tctan222-alt/ccm-fish-wage/pull/39) 最终 diff 仅保留 production legacy worker shape regression tests，临时 diagnostic UI 已移除。CI 通过，Standards / Spec review 无 findings；已合并为 `8dde4bad2819ecd746dded9243c0dcede647d61c`。tests-only 本身不需要 Firebase 发布。
- Worker Master Data 先前已获批准更正并验收：16 名 active、9 名 `fish_head_cutting`；本轮无需重复更改生产工人。
- [PR #42](https://github.com/tctan222-alt/ccm-fish-wage/pull/42) 已在 main，原 merge commit `5d2307c985628e7f533db0771346fd66e4553aa3`。本轮从 clean、synced、CI-passing main `8dde4bad2819ecd746dded9243c0dcede647d61c` 完成 Hosting-only 发布；线上 HTML、入口 JS 与称重页面 JS 均 HTTP 200，SHA-256 与本地构建一致。未发布 Rules / Functions。
- [PR #36](https://github.com/tctan222-alt/ccm-fish-wage/pull/36) 保持 Draft，留待 Priority 10；未合并。
- [PR #37](https://github.com/tctan222-alt/ccm-fish-wage/pull/37) 的 source identity（P1）和 stable revision read（P2）问题仍存在，分别安排在 Priority 5、6。
- [PR #32](https://github.com/tctan222-alt/ccm-fish-wage/pull/32) 为无关 Draft，不纳入本轮。
- 生产站：[CCM Fishery](https://ccm-fishery-os-4490d.web.app)。后续发布状态以各 Priority 交付记录为准。

## Priority 1：Fish Head Purchase 打开后立即可输入 kg

**目标：**进入 `/fish-head-purchase` 后尽快看到船号、鱼名，能够选鱼、输入 kg 并使用 keypad，不等待 Firestore reference data。

- Reference data 使用 cache-first / offline-first：先提供 `DEFAULT_VESSELS` / `DEFAULT_FISH_SPECIES`，读取 IndexedDB cached vessels/species 和 `lastVesselId`，再后台刷新 Firestore。网络刷新不得阻止输入。
- 将“可输入 kg”与“可正式确认 / 保存”分开。existing session 尚在核对时可先输入；confirm/save 必须等待必要 context validation。
- 后台刷新不得覆盖用户已经选择的 vessel、fish 或输入的 kg。换船后同样允许先输入，可提示“正在核对现场单…”，不能因此禁用 weight input / keypad。
- 保持 duplicate-session protection、completed/processed lock、offline queue、pending sync 和数据完整性。
- Latency regression 模拟 Firestore vessel/species 加载 3 秒；有 cache 不能等网络，无 cache 也先用 defaults 输入。

**交付：**独立 focused PR，完成并报告后再继续 Priority 2。

本轮实现：默认选项立即可用，IndexedDB 缓存独立读取，网络后台更新；保留用户船号 / 鱼名 / kg，输入与确认分别控制。确认仍等待当前真实船号的现场单核对，保留原锁定及离线同步规则。新增 3 秒网络延迟、缓存晚到、切船、canonical ID 变更、锁定和重复确认回归；无 Rules / schema / 生产数据迁移。Priority 1 尚未发布。

## Priority 2：未完成称重显示价格和金额

**正式业务变更：**现场称重尚未完成时也显示 purchase price；取代旧的现场隐藏价格规则。

- 每种鱼显示鱼名、篮数、总 kg、当前默认 RM/kg、当前金额；汇总总篮数、总 kg、当前总金额。每加入一篮立即更新。
- 必须复用正式 Purchase Settlement 的 `getDefaultFishHeadPriceCents()` 或等价正式 helper，包含 vessel-specific premium / pricing rule；同鱼、同船、同重量在现场和 settlement 得到相同默认价格及金额。
- 金额继续使用现有 integer cents + half-up helper，不另建浮点计算或第二套价格。
- Missing price 显示“单价 — / 金额 —”，不能视为 RM0。Grand Total 显示“已知金额 RMxxxx.xx”和“X 个鱼种尚未定价”；缺价不阻止称重。
- 仅为 live valuation preview：不创建 `purchaseSettlementDraft`，不自动 complete / processed，不写正式 settlement。流程仍为 Weighing → Complete → Settlement。

**交付：**独立 focused PR。

本轮实现：现场汇总同步调用正式 `buildPurchaseSettlementLines()`，复用默认价格、船号溢价、同鱼合计重量和 integer cents half-up 金额；不复制价格或另写金额公式。保存、撤回、作废及现有 entry 修改后立即重算，缺价显示破折号和未定价鱼种数。仅为只读预览，不写篮价格快照或 settlement draft，不改变称重状态、schema、Rules 或生产数据。跨模块、页面联动和 Priority 1 慢网络回归已覆盖；320 / 375 / 390 / 430px 本地浏览器检查无横向溢出。合并后停止，Priority 3 留待下一轮。

## Priority 3：未完成称重 entry 修改与即时重算

- `session.status = weighing` 时，可以修改任何 entry 的 kg / 鱼种、作废错误 entry、撤回上一篮。
- 不 hard delete；保留 audit / revision。先确认现有 EntryDialog 和 void/revision 能力，仅补齐缺口。
- 修改后立即重算总篮数、总 kg、每鱼篮数 / kg / default price / RM，以及 grand total RM。
- 不改变 7-day rule、settlement、pricing source 或 offline queue semantics。

## Priority 4：Fish Head Settlement 待结单首页

- `/fish-head-settlement` 默认显示 Fish Head weighing session 列表，默认 view 为“待结单”，按业务日期倒序。用户无需先选 vessel/date 才能发现刚完成的单。
- 每行至少显示日期、星期、vessel、external slip no、sessionCode、status、basket count、kg。
- 状态与操作：`weighing`＝称重中 / “继续称重”；`completed` 且未 processed＝待结单 / “查看结单”；`processed`＝已结单 / 已处理 / “查看历史”。`voided` 默认隐藏。
- 正常路径：打开鱼头结单 → 看见最新待结单 → 点击查看结单。

## Priority 5：Settlement source identity 使用 sourceSessionId

**目的：**解决 #37 P1 review finding。

- 从列表进入 `/fish-head-settlement/{sessionId}`；`sourceSessionId` 为 authoritative source，不再用 productType + date + vessel 猜 source session。
- 同一 sourceSessionId 始终找回同一个 draft，保留 saved prices；更正 vessel/date 后仍找回原 draft，不允许第二份 settlement draft。
- Legacy 兼容顺序：sourceSessionId 优先 → legacy key fallback → 安全绑定；不 destructive migration。
- 同船同日多张 session A / B 必须都可见、分别结单，不串重量或价格，不覆盖彼此 draft。

## Priority 6：Settlement stable revision read

**目的：**解决 #37 P2 review finding，避免并发 basket correction 导致新 session revision 配上旧 entries。

- 必须取得同一稳定 revision 的 session + entries，才允许 build settlement、计算金额或 save draft。
- 例如读 session revision A → 读 entries → 再读 session revision B；A ≠ B 时 retry 或 reject stale bundle。
- 保存时继续验证 sourceSessionId、source revision、draft revision。

## Priority 7：Settlement 筛选与历史查询

- 状态：待结单 / 称重中 / 已结单 / 全部。
- 日期：Today / Week / Month / Custom Range。
- 船：全部 / 指定 vessel。
- 支持查看整个月所有单、custom range 所有单、一只船的所有单；手机优先。
- 基于现有 dateSortKey 等合理限定查询，不一次加载巨大无边界数据。

## Priority 8：切鱼头工钱 Daily Details + Print

- 复用 `TodaySummaryPage` / `loadDailyWageData` 和既有 wage database，正式命名“切鱼头工钱每日明细”。`FishHeadWagePage` 增加“当天明细 / Daily Details”入口。
- 支持选日期，显示当天所有 active / non-voided wage entries。
- 每工人显示姓名、篮数、总 kg、wage subtotal；逐篮显示 sequence、weight kg、rate RM/kg、wage RM，例如 `1. 74kg × RM0.12 = RM8.88`。
- Grand Total 包含工人数、总篮数、总 kg、total wage。Void records 不计入 active total，原 audit 保留。
- “打印 Print”输出标题“切鱼头工钱每日明细”、日期、所有工人、所有 individual basket entries、每工人 subtotal 和 Grand Total。网页 `<details>` 即使折叠，打印也必须包含全部明细。
- 打印隐藏 navigation、date controls、refresh、Void buttons、action buttons、sign out。

## Priority 9：Retail Master Data 与 Seed Dataset

### 共用 Master Data

- Retail quick-add 复用同一套 fish Master Data，不建第二个 fish database。
- 正式字段：Chinese official name、Malay name、default RM/kg、aliases、active、sortOrder、audit timestamps。
- 搜索支持 Chinese / Malay / alias；选择带出 Chinese / Malay / default price。
- Invoice 可覆盖成交价，但不得回写 Master。Master 改价只影响之后新加入 invoice 的 item，历史 invoice snapshot 永远不变。
- Quick-add 写入同一套 Master Data。Inactive 历史仍显示，新 invoice 不建议；不 hard delete。

### Owner Seed Dataset

- 必须导入 Owner 之前提供的完整 Retail Master Data batch。先查仓库 / docs；未记录时从现有开发记录恢复，不自行重建或猜值。找不到完整 dataset 时暂停此 Priority，报告缺少 dataset。
- Malay blank、price blank 保持 blank；不猜、不自动补，不使用 Purchase / Fish Head price 填 Retail blank；中文拼写保留 Owner 原输入。
- “黑昌”不能作为 formal name 或 alias。若 production Master 已存在，将当前记录 inactive / deprecated，清除正式名称 / 别名可选来源，不破坏历史 invoice snapshot。
- 保留“大乌昌、乌昌、大中乌昌、中乌昌、乌昌仔、小乌昌仔”。

## Priority 10：重新整理 Retail PR #36

- 等前面 main 稳定后，基于最新 main 更新 / rebase / rebuild [#36](https://github.com/tctan222-alt/ccm-fish-wage/pull/36)。不强行合并旧 Draft。
- **72h edit：**从首次 createdAt 起 `<72h` 可改 Vendor、fish、Chinese / Malay snapshot、weight、unit price、remark；update 同一 invoice，revision +1。invoice date、invoice number、createdAt 不可改。`>=72h` locked，仍可 view / print / PDF/share；期限必须由 Firestore `request.time` 强制。
- **Invoice number：**`DDMMYYYY001`，同业务日期从 001 递增，至少 3 位，新一天重置。使用 atomic daily counter transaction，禁止 count existing + 1；并发不撞号，失败 / retry 不重复占号。
- **Retail 日期：**可见日期统一 `DDMMYYYY 星期X Eng-short`，例如 `08092026 星期二 Tue`。内部 dateSortKey `YYYYMMDD`、monthSortKey `YYYYMM`、Timestamp 保持不变。
- **Coordinated release：**old Hosting / new Rules 不兼容，最终 merge 后必须协调 Rules + Hosting 发布；不部署 feature branch。

## 每项完成报告

依次报告：root cause / previous behavior、implementation、修复后的业务行为、compatibility、production data impact、changed files、tests、Rules 是否改变、PR number、merge status、deploy status、remaining backlog。
