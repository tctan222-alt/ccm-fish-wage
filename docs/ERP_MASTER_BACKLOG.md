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
| 1 | Fish Head Purchase 立即输入 kg | 已合并 [PR #43](https://github.com/tctan222-alt/ccm-fish-wage/pull/43)，已随 `e85484d` Hosting-only 发布，见下方发布检查点 |
| 2 | 未完成称重实时价格与金额 | 已合并 [PR #44](https://github.com/tctan222-alt/ccm-fish-wage/pull/44)，`e85484d6281e4c1ca101e557bcba0381ed51ea68`；已 Hosting-only 发布并核对线上文件哈希 |
| 3 | 未完成称重 entry 修改与即时重算 | 已合并 [PR #45](https://github.com/tctan222-alt/ccm-fish-wage/pull/45)，`75bb0e0` 已 Hosting-only 发布，线上文件哈希已核对 |
| 4 | Fish Head Settlement 待结单首页 | 已合并 [PR #46](https://github.com/tctan222-alt/ccm-fish-wage/pull/46)，`1cc1278` 已 Hosting-only 发布，线上文件哈希已核对 |
| 5 | Settlement sourceSessionId identity | 已合并 [PR #47](https://github.com/tctan222-alt/ccm-fish-wage/pull/47)；#37 P1 已 resolved，已随 `3880b1c` coordinated release |
| 6 | Settlement stable revision read | 已合并 [PR #48](https://github.com/tctan222-alt/ccm-fish-wage/pull/48)，`3880b1c`；#37 P2 已 resolved，Rules → Hosting coordinated release 已完成 |
| 7 | Settlement 筛选与历史查询 | 本轮实现；PR / CI / merge 以 GitHub 为准，P7 不自动部署；见 [实现及验证](P7_SETTLEMENT_FILTERS.md) |
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

本轮实现：默认选项立即可用，IndexedDB 缓存独立读取，网络后台更新；保留用户船号 / 鱼名 / kg，输入与确认分别控制。确认仍等待当前真实船号的现场单核对，保留原锁定及离线同步规则。新增 3 秒网络延迟、缓存晚到、切船、canonical ID 变更、锁定和重复确认回归；无 Rules / schema / 生产数据迁移。

## Priority 2：未完成称重显示价格和金额

**正式业务变更：**现场称重尚未完成时也显示 purchase price；取代旧的现场隐藏价格规则。

- 每种鱼显示鱼名、篮数、总 kg、当前默认 RM/kg、当前金额；汇总总篮数、总 kg、当前总金额。每加入一篮立即更新。
- 必须复用正式 Purchase Settlement 的 `getDefaultFishHeadPriceCents()` 或等价正式 helper，包含 vessel-specific premium / pricing rule；同鱼、同船、同重量在现场和 settlement 得到相同默认价格及金额。
- 金额继续使用现有 integer cents + half-up helper，不另建浮点计算或第二套价格。
- Missing price 显示“单价 — / 金额 —”，不能视为 RM0。Grand Total 显示“已知金额 RMxxxx.xx”和“X 个鱼种尚未定价”；缺价不阻止称重。
- 仅为 live valuation preview：不创建 `purchaseSettlementDraft`，不自动 complete / processed，不写正式 settlement。流程仍为 Weighing → Complete → Settlement。

**交付：**独立 focused PR。

本轮实现：现场汇总同步调用正式 `buildPurchaseSettlementLines()`，复用默认价格、船号溢价、同鱼合计重量和 integer cents half-up 金额；不复制价格或另写金额公式。保存、撤回、作废及现有 entry 修改后立即重算，缺价显示破折号和未定价鱼种数。仅为只读预览，不写篮价格快照或 settlement draft，不改变称重状态、schema、Rules 或生产数据。跨模块、页面联动和 Priority 1 慢网络回归已覆盖；320 / 375 / 390 / 430px 本地浏览器检查无横向溢出。

**Priority 1 + 2 发布检查点（2026-09-30）：**Owner 授权后，从 clean、synced main `e85484d6281e4c1ca101e557bcba0381ed51ea68` 重新构建，使用 `firebase-tools@15.29.0` Hosting-only 发布。main CI [run 36730291415](https://github.com/tctan222-alt/ccm-fish-wage/actions/runs/36730291415) 第二次执行通过；首次切船测试失败，诊断发现它可能在异步 mock option 尚未出现时选择 `v833`，导致空选择。本轮补充明确 option-ready 前置条件，不增加 timeout 或修改 P1 runtime。生产 `/fish-head-purchase`、HTML、入口 JS/CSS、称重页面及结单计算 chunk 均 HTTP 200，SHA-256 与本地构建完全一致。未发布 Rules / Functions，未写生产测试记录。

## Priority 3：未完成称重 entry 修改与即时重算

- `session.status = weighing` 时，可以修改任何 entry 的 kg / 鱼种、作废错误 entry、撤回上一篮。
- 不 hard delete；保留 audit / revision。先确认现有 EntryDialog 和 void/revision 能力，仅补齐缺口。
- 修改后立即重算总篮数、总 kg、每鱼篮数 / kg / default price / RM，以及 grand total RM。
- 不改变 7-day rule、settlement、pricing source 或 offline queue semantics。

本轮补齐：历史行显示编辑入口，既有 EntryDialog 显示篮号、当前鱼名/kg、记录时间、revision/sync；删除使用现场用语及带鱼名/kg 的确认，底层仍调用 soft void 并保留审计。本机保存失败保留输入，离线成功明确提示待同步；修改沿用正式估值并不写 purchase price snapshot，旧值保留于审计 before payload。复用 #42 单队列，修复同时间 revision 字符串排序以及旧服务器回执覆盖新本机修改的问题：按数值修订排序，同一 IndexedDB transaction 内保留后续 pending 状态与本机总数、应用回执和移除已确认操作。不修改 Firestore schema、Rules 或 7 天复核流程。

本地验收：真实浏览器 IndexedDB 的 create → update → void、迟到回包和重叠 flush 验证通过，最终 pending 0、本机与模拟服务器总数一致。320 / 375 / 390 / 430px 弹窗与长鱼名滚动已视觉检查，实点改 kg / 鱼种即时更新金额；内置浏览器自动化在原生删除确认框处阻塞，删除确认 / 取消 / soft void 已由页面回归测试覆盖，未宣称完成真实 iPhone 验收。

**Priority 3 发布检查点（2026-10-03）：**从 clean、synced main `75bb0e051311669dd09d45dc7ba8ed364113d530` 重新构建；main CI [run 37086583539](https://github.com/tctan222-alt/ccm-fish-wage/actions/runs/37086583539) 全绿。使用 `firebase-tools@15.29.0` Hosting-only 发布成功。生产 `/fish-head-purchase`、HTML、入口 JS/CSS、称重页面、现场入口和结单计算 chunk 均 HTTP 200，SHA-256 与本地构建完全一致（HTML `e6b5cb0a2946b2ddf8cc216e4801e7b37f3fc056ef7ad79d47311e2476f0a562`）。未发布 Rules / Functions，未写生产假记录；Owner 之后进行真实 iPhone 业务验收。

## Priority 4：Fish Head Settlement 待结单首页

- `/fish-head-settlement` 默认显示 Fish Head weighing session 列表，包含称重中 / 待结单 / 已结单，待结单明显标记，默认隐藏已作废；按业务日期倒序，同日按 updatedAt / createdAt 倒序。用户无需先选 vessel/date 才能发现刚完成的单。此显示范围遵循 Owner 最新 P4 任务；高级 filters 留待 Priority 7。
- 每行至少显示日期、星期、vessel、external slip no、sessionCode、status、basket count、kg。
- 状态与操作：`weighing`＝称重中 / “继续称重”；`completed`＝待结单 / “查看结单”；`processed`＝已结单 / “查看结单”（现有只读历史详情）。`voided` 默认隐藏。
- 正常路径：打开鱼头结单 → 看见最新待结单 → 点击查看结单。

本轮 gap analysis：原 base route 与 detail 共用表单，默认今天 + 第一艘 active vessel，再由 `loadPurchaseSettlementSource()` 的 `find()` 取第一张，无法直接发现其他日期/船号及同船同日多张单。只替换鱼头 base route 为独立列表，复用 `loadWeighingSessions()`，strict `productType === fish_head`；React key 和导航均使用 session.id，不 collapse。`weighing` 进入 `/weighing/{id}` 继续既有现场单；`completed` / `processed` 进入现有 `/fish-head-settlement/{id}`，详情价格、草稿、只读 / 7 天规则及完成后的 direct link 均保持原实现。列表每次 mount 重新查询，提供刷新/错误重试和取消过期响应，loading / empty / error 分开；未添加 artificial delay。

本地手机验收：320 / 375 / 390 / 430px 浏览器检查，页面及 card 的 scrollWidth 等于 clientWidth，长手写单号正常换行；同船同日第二张单实点进入正确 session-b。固定本地数据及外部连接限制用于 UI 验证，未写生产数据。P5 的旧 date + vessel draft identity 碰撞和 P6 stable revision 问题仍留待下一轮；Priority 4 合并后停止，不部署，不开始 Priority 5–10。

本地完整质量检查：587 / 587 application tests passed，typecheck、lint、build 和 `git diff --check` 通过；lint 保留既有 AuthProvider Fast Refresh warning，build 保留既有 bundle-size warning。Rules 未改；focused PR 继续由既有 CI quality / firestore-rules jobs 验证。

**Priority 4 发布检查点（2026-10-03）：**从 clean、synced main `1cc12788f19afc1ca3136b6953c6c27e3a022f04` 重新构建；main CI [run 37088837464](https://github.com/tctan222-alt/ccm-fish-wage/actions/runs/37088837464) 全绿。使用 `firebase-tools@15.29.0` Hosting-only 发布成功。生产 `/fish-head-settlement`、HTML、入口 JS/CSS、结单列表和详情 chunk 均 HTTP 200，SHA-256 与本地构建完全一致（HTML `7c5ec21c16dc151354986f2a4190d90172f8122d27e5fc5f47fb3faf9fbf0bf7`）。未发布 Rules / Functions，未写生产假记录。

## Priority 5：Settlement source identity 使用 sourceSessionId

**目的：**解决 #37 P1 review finding。

- 从列表进入 `/fish-head-settlement/{sessionId}`；`sourceSessionId` 为 authoritative source，不再用 productType + date + vessel 猜 source session。
- 同一 sourceSessionId 始终找回同一个 draft，保留 saved prices；更正 vessel/date 后仍找回原 draft，不允许第二份 settlement draft。
- Legacy 兼容顺序：sourceSessionId 优先 → legacy key fallback → 安全绑定；不 destructive migration。
- 同船同日多张 session A / B 必须都可见、分别结单，不串重量或价格，不覆盖彼此 draft。

本轮实现：加载先查询 `sourceSessionId`，保留实际 `draftId`；新草稿 ID 为 `${productType}_session_${sourceSessionId}`。现有绑定草稿不受 date/vessel 更正影响；未绑定 legacy 只有原 source entry IDs 能证明属于当前 session 时才允许在正常保存事务中绑定，不复制或重编号。Legacy tuple 路径若出现同船同日多来源直接报错，要求从 session 列表选择。

每次保存事务重新读取 source、actual draft 和不可改写的 `purchaseSettlementSources` source→draft 指向记录，验证来源 revision、草稿 revision、当前 metadata、原有期限与锁定，并原子保存 audit。指向记录不包含价格或业务草稿副本，仅防止 legacy 绑定和 canonical create 同时建立两份。发现重复 active draft、其他来源绑定或过期装置 identity 时明确报错并显示 IDs，不自动修数据。

价格、默认价快照、priceWasEdited、createdAt/createdBy、真实 legacy ID 均保留；当前重量变化仍通过既有 reconciliation / integer cents 金额逻辑重算。Rules 仅配套 settlement identity / binding / metadata 约束，不放宽其他业务 collection。无 bulk migration 或生产写入；Priority 6 的稳定 revision 读取协议仍未实现。合并后停止，后续需 Owner 明确授权 coordinated Rules + Hosting release。

本地验证：625 / 625 application tests、34 / 34 Rules Emulator tests（CLI 15.29.0）通过；Rules compile / size gate 为 252,010 bytes，低于 253,952 bytes CI budget。真实 Emulator 同时首建只留一份草稿；竞争者可能得到权限／冲突错误，页面明确要求重新载入，并保留赢家价格。没有为此放宽 Rules 或覆盖 stale revision。日期／船号单独及同时更正、跨月、重复更正 legacy 查找、实际 ID 连续保存、fish-meal、审计和原期限均有回归覆盖。

## Priority 6：Settlement stable revision read

**目的：**解决 #37 P2 review finding，避免并发 basket correction 导致新 session revision 配上旧 entries。

- 必须取得同一稳定 revision 的 session + entries，才允许 build settlement、计算金额或 save draft。
- 例如读 session revision A → 读 entries → 再读 session revision B；A ≠ B 时 retry 或 reject stale bundle。
- 保存时继续验证 sourceSessionId、source revision、draft revision。

本轮实现：增加结单专用 `loadStableWeighingBundle()`；每次 server session A → server entries + actions → server session B，比较 revision、source ID、类型、状态、日期、船号、必要 metadata / totals 和时间 token。最多 3 次 attempt，变化时丢弃整份数据；耗尽明确报错并允许原页重试，不显示旧行、RM0 或无资料提示。读取拒绝缓存与 pending writes；网络/权限失败给中文错误，不 fallback stale bundle。

所有正式 source path 统一：鱼头／鱼仔 sessionId 详情、旧 vessel/date source resolver、首次保存前 legacy ownership discovery。旧 tuple 只用于发现来源，返回 stable bundle.session；发现期间日期／船号更正时要求重新选择，避免旧 UI context 配新数据。用于证明旧草稿的 entry snapshots 与 session_update audit 在同一 attempt 读取；独立 sync_conflict audit 不改变财务或 ownership proof。一般 `loadWeighingBundle()`、现场 offline queue 与 Priority 1–3 读取策略不改。

并发 invariant 已核查：所有 entry create/update/species change/soft void、metadata、reopen、completion、process 均原子递增 session revision，现有 Rules 强制；新增 Emulator 回归证明未递增／跳号拒绝且不留下半笔写入。保存继续 transaction reread，与 accepted stable revision 不符即拒绝；P5 actual ID、source pointer、saved RM2.90、默认 snapshot、audit 和原锁定期限不变。Rules 未修改，compiled size 仍 252,010 bytes；无生产数据写入、迁移或部署。P5 + P6 后续等待 Owner 明确授权 coordinated Rules + Hosting release。

本地验证：662 / 662 application tests、38 / 38 Rules Emulator tests（CLI 15.29.0）、typecheck、lint、build、配置语法及 `git diff --check` 通过。核心 loader race、pending metadata 和错误状态均先红后绿；恢复旧 source resolver / 新保存 preflight 会使实际 loader 回归失败。Standards / Spec review 无 blocker。既有 Fast Refresh / bundle-size warnings 保留，不影响质量 gate。

## Priority 7：Settlement 筛选与历史查询

- 状态：待结单 / 称重中 / 已结单 / 全部。
- 日期：Today / Week / Month / Custom Range。
- 船：全部 / 指定 vessel。
- 支持查看整个月所有单、custom range 所有单、一只船的所有单；手机优先。
- 基于现有 dateSortKey 等合理限定查询，不一次加载巨大无边界数据。

2026-10-03 Owner 本轮允许小规模阶段保留现有 loader，保证旧待结单不因日期默认值或 legacy dateSortKey 缺失而隐藏。本轮仍一次读取现有 sessions，再按真实业务日期、状态和 vesselId 组合筛选；没有新增索引／Rules，切换筛选不额外读 Firestore。规模限制及之后 server-side query 的前提见 [P7 文档](P7_SETTLEMENT_FILTERS.md)。默认是待结单 + 全部日期；P7 merge 后停止，不自动部署或开始 P8。

### P5 / P6 coordinated production release checkpoint

Owner 明确授权后，从 clean、synced、CI-green `3880b1c99b5fecfb8c34a98049968507848af9bc` 执行 CLI 15.29.0 Rules → Hosting。发布前复核 662 app tests、38 Rules tests、production build 和 Rules compile / size（252,010 bytes ≤ 253,952）。Rules release PATCH HTTP 200，指针更新到 `c6ff31c6-300a-4d31-8d0e-389fa316daec`；随后 Hosting release 成功。

生产 `/`、`/fish-head-settlement`、`/fish-head-purchase` 均 HTTP 200；HTML、`index-BQYBvgwQ.js`、`index-D5RMLzAT.css`、`PurchaseSettlementPage-CmmpqVfg.js`、`weighing-CNhV3bze.js` 的 SHA-256 与该 main 构建逐文件一致。HTML hash `4f5362554e613830e602aed117704c5b3d63d5b97da9ad7f4dc8c3ab0ff36ae5`。未发布 Functions / 其他服务，未写生产业务测试记录，未迁移历史。此前 P5/P6 章节的“等待授权／未部署”是实施时检查点，已由本次发布记录更新。

## Priority 8：切鱼头工钱 Daily Details + Print

**Priority 7 production checkpoint（2026-10-03）：**Owner 明确授权后，从 clean、synced、main CI-green `5343a18ad6120e328a21611618f3869c1b399533` 重新 production build，通过后执行 CLI 15.29.0 Hosting-only release。生产 `/`、`/fish-head-settlement`、`index-Bx-_-YRG.js`、`index-CzZ_fjtI.css`、`FishHeadSettlementListPage-BriH9c5t.js` 均 HTTP 200 且 SHA-256 与本地构建逐文件一致；HTML hash `8aebb5a552466b890f0fb1b4a7cbcec8cc2fd9bf5b38a366fb9703015566310b`。未部署 Rules / Functions / 其他 service，未写 production business records。

- 复用 `TodaySummaryPage` / `loadDailyWageData` 和既有 wage database，正式命名“切鱼头工钱每日明细”。`FishHeadWagePage` 增加“当天明细 / Daily Details”入口。
- 支持选日期，显示当天所有 active / non-voided wage entries。
- 每工人显示姓名、篮数、总 kg、wage subtotal；逐篮显示 sequence、weight kg、rate RM/kg、wage RM，例如 `1. 74kg × RM0.12 = RM8.88`。
- Grand Total 包含工人数、总篮数、总 kg、total wage。Void records 不计入 active total，原 audit 保留。
- “打印 Print”输出标题“切鱼头工钱每日明细”、日期、所有工人、所有 individual basket entries、每工人 subtotal 和 Grand Total。网页 `<details>` 即使折叠，打印也必须包含全部明细。
- 打印隐藏 navigation、date controls、refresh、Void buttons、action buttons、sign out。

P8 复用现有每日 loader、worker grouping、stored wage cents totals 和 void audit，没有新增 wage database、summary document 或工资公式。正式入口为 `/daily?date=YYYY-MM-DD`；`/today` 继续可用。页面与打印共用篮表、小计及总计 renderer，print-only 完整视图不使用折叠容器，屏幕所有 `<details>` 折叠时仍打印全部明细。实现及验证范围见 [P8 每日明细 / 打印文档](P8_DAILY_WAGE_PRINT.md)。P8 merge 后停止，不自动部署，不开始 Priority 9–10。

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
- **30-day edit (OWNER latest decision)：**从首次 createdAt 起 `<30 days` 可改 Vendor、fish、Chinese / Malay snapshot、weight、unit price、remark；update 同一 invoice，revision +1。invoice date、invoice number、createdAt 不可改。`>=30 days` locked，仍可 view / print / PDF/share；期限必须由 Firestore `request.time` 强制。
- **Invoice number：**`DDMMYYYY001`，同业务日期从 001 递增，至少 3 位，新一天重置。使用 atomic daily counter transaction，禁止 count existing + 1；并发不撞号，失败 / retry 不重复占号。
- **Retail 日期：**可见日期统一 `DDMMYYYY 星期X Eng-short`，例如 `08092026 星期二 Tue`。内部 dateSortKey `YYYYMMDD`、monthSortKey `YYYYMM`、Timestamp 保持不变。
- **Coordinated release：**old Hosting / new Rules 不兼容，最终 merge 后必须协调 Rules + Hosting 发布；不部署 feature branch。

## 每项完成报告

依次报告：root cause / previous behavior、implementation、修复后的业务行为、compatibility、production data impact、changed files、tests、Rules 是否改变、PR number、merge status、deploy status、remaining backlog。


## 2026-10-03 OWNER operations batch (development only)

- **Retail approved dataset:** repo seed contains 31 formal names, in OWNER order: 来戈、金线、朱力、什鱼、戈里、肉江、丁温、成鱼、目力、代仔、红目林、白月、白竹占、大目、甘丰、马丰、上过、红介、白皂、红皂、竹加、马加、文冬、长里、水昌、大乌昌、乌昌、大中乌昌、中乌昌、乌昌仔、小乌昌仔。黑昌 / 青兰 are excluded. Only 甘丰 600, 马丰 800, 上过 3300 cents; all other defaults are null. Existing Retail Malay names and aliases are preserved; no Purchase Master prices/translations are imported.
- **Future import, NOT executed:** empty Retail Master can explicitly initialize the repo seed; server emptiness is rechecked after transaction reads. A completed initialization retry is a no-op, while a non-empty incomplete/custom Master refuses bulk initialization. For an existing Master, pure `planRetailOwnerReconciliation(existingRetailFish)` generates exact before/after proposals, retaining existing IDs/Malay/aliases. Applying its output again produces no changes. Duplicate names/seed ID conflicts stop the plan. `planDeprecatedRetailNames` proposes deactivation without deletion. OWNER must review and authorize a later production import; this batch contains no import execution or production writes.
- **Retail vessel:** each invoice independently stores `vesselId` + `vesselCodeSnapshot`. Active existing Master choices only; last selection remains in the current form for Next Vendor. Within the existing server-enforced 30-day window, vessel changes update the same invoice, revision and audit. Creation/date/number stay immutable. Missing-vessel legacy invoices show —; unchanged inactive snapshots remain valid. History, invoice, print and prepared PDF content include the snapshot; print/share mechanisms are unchanged.
- **Universal Home:** one authenticated navigation component outside child routes links to canonical `/dashboard`; no auth/session mutation. Hidden on Dashboard/Login and in print; target is at least 44px.
- **Daily Print diagnosis:** OWNER confirmed a disabled/loading button. Previously `loadDailyWageData` waited for both active entries and void history before enabling Print. A regression reproduces active entries resolved while audit history remains pending. The page now loads these independently, distinguishes error/empty/loading, rejects stale callbacks and offers timeout/retry feedback. Void history does not block ready active totals. Native synchronous `window.print()` and existing complete A4 report are retained. Local Chromium beforeprint is observed; physical iPhone Safari print-sheet acceptance remains unverified.
- **Monthly wages:** normal view shows worker work days/baskets/kg/cents and daily all-worker totals linked to existing `/today?date=...`. Integer-cent worker sum = day sum = month sum; closed snapshot mismatches in worker count, basket count, kg or wage cents are visible. Payment/remark controls are absent, payment records are not queried by the normal summary loader, and legacy payment/closing data and backend protections remain intact.
- **Shared head/meal search:** both base routes use one date-first list, initially current month through today, all vessels and all live statuses. Today/Week/Month/custom and filter URL state remain. From/To, status and optional vessel changes apply only on Search, avoiding request storms. Inactive Master and historical result snapshots remain filterable.
- **Query architecture:** authenticated read-only Firestore REST StructuredQuery `select` projections load headers only, never basket/action/species/draft-line detail. Product/date/status/optional vessel are server constraints. Legacy ISO dates and canonical DD/MM/YYYY dates are merged chronologically; canonical stream queries selected months with the Rules-enforced DD/MM/YYYY + MM/YYYY pair; the ISO stream queries YYYY-MM-DD dates within individual century bounds so DD/MM dates cannot enter even across 2000. These streams are disjoint. Each server page is limited to 25, with immutable cursor buffers and Load More. Each request probes at most two ISO century pages and six canonical months and returns a resumable partial page, so sparse/empty large ranges do not scan every month before rendering. Unchecked newer months are completed before older ISO records are emitted. Bound draft amounts are fetched as projected headers in batches and used only when source revision matches; processed receipts supply stored amounts. Unpriced/stale/unprovable legacy amounts show — until detail is opened. Existing stable source reads and sourceSessionId identity checks stay on existing detail routes.
- **Indexes:** `firestore.indexes.json` declares four weighingSessions composites (product + status + optional vessel + optional monthKey + descending weighingDate/name); firebase.json references the file. This batch does NOT deploy them. Official projection contract: https://docs.cloud.google.com/firestore/docs/reference/rest/v1/StructuredQuery .
- **Future release requirements:** coordinated Rules + indexes + Hosting from clean merged main; create indexes and wait until ready, publish Rules successfully, then Hosting. No Functions. Not authorized/executed in this development task. Rules budget remains 253952; current compiled estimate is 253355 bytes. Do not raise the budget or weaken checks.

- Pending Retail checkout recovery: a server-only read first reconciles the original invoice ID. Only confirmed-uncommitted checkouts unlock vessel reselection; original input/ID and immutable groups remain intact, corrected vessel is stored separately for retries, and the transaction accepts a competing original commit without allocating another number. Offline/failed verification never unlocks correction.
