# 潮州话语音识别测试

独立本地 benchmark，比较同一段「鱼名 + kg 重量」录音的 OpenAI 与腾讯 ASR 结果。不会修改 ERP 页面、Firestore Rules、Master Data 或称重记录，不需要 Firebase 部署、Blaze、Cloud Functions。没有讯飞或豆包 adapter。

## 启动

需要 Node.js 22.18+（本轮使用 26.5.1）。在 PowerShell 执行：

```powershell
cd C:\Users\tctan\ccm-fish-wage\tools\voice-asr-benchmark
npm.cmd ci
Copy-Item .env.example .env
# 用本地编辑器填入 .env 中的凭据；不要粘贴到聊天、Git 或录音中。
npm.cmd run build
npm.cmd start
```

打开 <http://127.0.0.1:8787>。后续启动不需要再次复制 `.env.example`。进程环境变量优先于 `.env`，修改凭据后重启本地服务，再点「重新检查连接」。缺少凭据的 provider 显示「未配置」，不能选中；两个都没配置时显示「尚未配置任何语音识别服务」，不发送比较请求，也不生成失败样本。

1. 从已读取的 active fish species 选择正确鱼名，并填写正确重量，例如 `80.5`。
2. 录音一次后停止、播放，也可导入音频文件。最长 45 秒，文件上限 50 MB；浏览器在本机统一转换为 16 kHz 单声道 PCM16 WAV。
3. 默认只选中已配置的 provider：可以仅运行 OpenAI 或仅运行 Tencent；两家都选中时，点击「开始比较」才将**同一份 WAV 字节**通过本地 backend 并行送出。没有自动上传、自动重试或答案提示。
4. 查看两家原始识别、解析结果、评分、错误及耗时；「导出 CSV」下载历史数据。需要重新录制时点击「开始录音」。

ASR 服务可能按账号规则计费；只有配置凭据并主动比较才调用。当前实现及自动化测试不发出真实 ASR 请求，也不提供虚构识别成绩。

## 连接、录音与比较状态

页面分别显示 Server「已连接／未连接」、OpenAI/Tencent「可用／未配置」和录音「未录音／已录音 X 秒」。这里的「可用」只表示后端读取到了所需环境变量，不代表已验证账号权限、额度或实际识别效果；这些调用失败会显示具体中文错误。

页面启动及每 10 秒通过同源 `GET /api/health` 检查本地连接；进行中的比较不会被后台检查打断。它不调用 provider、不读取 Master Data，也不返回 key、secret、token 或其他配置值：

```json
{"ok":true,"providers":{"openai":{"configured":false},"tencent":{"configured":false}}}
```

比较仍使用同源 `POST /api/benchmark`；没有额外的 provider 专属浏览器路由。后端从环境读取 `OPENAI_API_KEY`，腾讯须同时具备 `TENCENT_SECRET_ID` 和 `TENCENT_SECRET_KEY`。后端也会在保存音频前拒绝未配置服务，返回 HTTP 503 与明确中文原因。

- Compare 旁始终显示禁用原因，例如「请先录音」「请输入预期重量 kg」「尚未配置任何语音识别服务」或本地服务连接错误。
- 点击后立即显示「比较中...」并防止重复提交；成功显示结果，失败在状态和结果表显示中文错误，完成后重新计算按钮状态。
- 断线时启动本地服务后点「重新检查连接」，已有录音不会丢失。历史结果加载失败单独提示，不再锁住录音与输入。
- Stop 后须完成解码及 WAV 转换才能比较。解码/麦克风错误会显示操作提示；取消选择音频文件会保留原有录音。

本次修复的复现结论：旧版 handler 已绑定，但无音频时按钮直接 disabled，且无原因说明；打开文件选择器就会清空音频，取消后仍无法比较；初始化中的历史读取失败还会锁住整个 fieldset。缺 credentials 本身不阻止旧版发送 HTTP，只会让 adapter 返回 `NOT_CONFIGURED`。回归测试直接执行构建后的真实页面脚本，覆盖这些状态，而不只测试一个孤立判断函数。

## ERP Master Data 的只读来源

固定读取项目 `ccm-fishery-os-4490d` 的 `fishSpecies` 集合（不是 `retailFish`），只保留 `active === true` 的文档 ID、`displayName` 和可选 `voiceAliases`。

- 设置 `ERP_FIRESTORE_TOKEN` 时，backend 仅以 `GET` 调用 Firestore REST 列表接口，自动分页并保存本地快照。使用已有读取权限的有效 Firebase ID token 或 Google OAuth access token；不需要或接受 service-account JSON。实时刷新失败时不悄悄回退旧快照。
- 没有 token 时，只读取 `data/master-data.json` 的真实 ERP 导出。页面显示快照来源与时间，快照只代表该读取时刻的 active 状态。没有真实快照时禁用有效比较，不使用代码内默认鱼名。
- `npm.cmd run refresh:master` 用环境 token 主动只读刷新快照；运行中的进程最多缓存 60 秒。也可在停止服务后放入已有 ERP 导出，格式如下（示意 ID/名称必须替换为真实主档值）：

```json
{
  "projectId": "ccm-fishery-os-4490d",
  "collection": "fishSpecies",
  "fetchedAt": "2026-09-07T00:00:00.000Z",
  "fish": [{ "id": "真实文档ID", "displayName": "真实主档鱼名", "active": true, "voiceAliases": [] }]
}
```

本次工作已利用本机现有 Firebase CLI 登录只读取得 21 个 active 鱼种，放在被 Git 忽略的 `data/master-data.json`。其他机器需自行提供有效读取凭据或真实导出；仓库不携带生产 Master Data。

## 评分、别名与重量

- 匹配顺序：主档名称 exact → 主档 `voiceAliases` / 本地 alias exact → 编辑距离相似度 top 3。比较时忽略空白、标点及大小写。重复名称/冲突 alias 不自动确认。
- fuzzy 只有建议，`parsedFishCandidate` 为 null、鱼名正确为 false；最多给出三个 active 主档鱼名，不创造新鱼种。
- 「记为语音别名」要求明确选择目标鱼种，只写入本地 `benchmark.json` 的 aliases。更改别名只影响未来测试；每次样本保存当时的别名和鱼种快照，历史成绩不重算。
- 重量以整数十分之一 kg 比较，支持 `80`、`80.5`、`八十`、`八十点五`、`80.5 kg`、`80.5 kilo`。`80.55` 等超精度输入保留 `weight parse error`，不四舍五入；不猜斤、两或其他单位换算。模糊/多重量、非正数同样拒绝。prototype 不施加正式 ERP 的旧整数重量上限。
- `wholeBasketCorrect = fishCorrect && weightCorrect`。provider 失败两项都为 false；重量解析失败仍可独立判断鱼名。
- 每家准确率分母为该 provider 所有已保存尝试（包括失败）。平均耗时包含失败请求；错误次数包含 provider / 重量解析错误。新版未配置请求不会创建样本；旧版本已保存的失败样本仍保持不变。正式测评不要混合不同环境/模型成绩。

## Provider 配置与局限

统一 interface 在 `shared/types.ts`：`transcribe(audio)` 返回 `provider/model/rawTranscript/latencyMs/error`。两家拿到同一 `AudioInput`，保存服务器计算的 SHA-256、字节数、格式、时长作为核对依据；OpenAI multipart 与腾讯 base64 解码后的 WAV 相同。

- **OpenAI**：`POST https://api.openai.com/v1/audio/transcriptions`，默认 `gpt-transcribe`，可用 `OPENAI_ASR_MODEL` 改为账号可用的官方模型。参考 [Speech-to-text guide](https://developers.openai.com/api/docs/guides/speech-to-text) 和 [model](https://developers.openai.com/api/docs/models/gpt-transcribe)。
- **腾讯云**：`SentenceRecognition`，版本 `2019-06-14`，TC3-HMAC-SHA256 签名，内联 WAV，默认 `16k_zh`；`TENCENT_ASR_ENGINE` 可选择该接口实际支持的引擎。参考官方 [请求定义](https://github.com/TencentCloud/tencentcloud-sdk-nodejs/blob/master/src/services/asr/v20190614/asr_models.ts)、[接口 client](https://github.com/TencentCloud/tencentcloud-sdk-nodejs/blob/master/src/services/asr/v20190614/asr_client.ts) 和 [签名](https://github.com/TencentCloud/tencentcloud-sdk-nodejs/blob/master/src/common/sign.ts)。该短句接口文档未确认潮汕话支持，不能保证潮州话准确率；不把其他腾讯产品的同名引擎直接套用。腾讯账号可能配置默认热词；本工具不发送热词或正确答案，公平比较时需确认账号没有默认定制，或单独记录该条件。

超时默认 60 秒，可由 `ASR_TIMEOUT_MS` 调整，上限 120 秒。失败保留安全错误代码，例如 `HTTP_401`、`TIMEOUT`；不返回上游任意 error body、请求头、堆栈或凭据。未完成真实录音测评前，不据此认定哪家更准确。

## 本地数据及安全边界

- `data/benchmark.json` 保存所有样本、正确答案、audio metadata、每家结果及评分、快照与本地 aliases；`data/audio/<sampleId>.wav` 保存唯一规范化音频。
- 文件写入序列化并原子替换，损坏 JSON 不覆盖。先保存音频再请求 ASR，避免磁盘无法写入时产生付费调用。进程意外退出可能留下无结果 WAV；保留它用于诊断。本地仅运行一个服务进程，勿让两个进程共享数据目录。
- `data/`、`.env*`、`node_modules/` 均被忽略（仅 `.env.example` 提交）。构建产物存入本工具的 `node_modules/.cache/voice-asr-benchmark/`，避免进入 ERP 的源文件 lint 范围，不需修改根配置。`npm ci` 后重新 build。本地录音不通过静态服务器对外提供。原始录音只在主动比较时离开本机，到达所选 provider。
- 只监听 `127.0.0.1`；Host、Origin、跨站请求和 mutation token 校验；静态文件只允许三个构建产物。不要放到公网代理或生产 Hosting。
- API secrets 只在 Node backend 的环境中读取，不进入浏览器 bundle、CSV、Git 或日志。浏览器只拿到 provider 是否配置及非敏感模型名称。代码不包含生产写入或部署接口。
- 点击比较后不要在网络结果不确定时立即重试：先刷新查看历史，避免把同一录音再次计分。主动重复比较会创建新 sample；不是音频内容去重。

CSV 固定列（UTF-8 BOM / CRLF、引号换行转义、防表格公式注入）：

```text
sampleId,expectedFishName,expectedWeightKg,provider,rawTranscript,parsedFishName,parsedWeightKg,fishCorrect,weightCorrect,wholeBasketCorrect,latencyMs,error
```

## 验证与文件

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
npm.cmd run build
```

`test/*.check.ts` 使用 Node test runner，刻意不混入 ERP 的 Vitest 测试收集。测试覆盖匹配顺序/主档约束、重量和整篮评分、CSV、两家 mock adapter/TC3 签名、同音频并行与 provider 选择、读取权限/快照、本地持久化、CSRF/静态边界和真实 browser bundle 的 secret sentinel 检查。自动化 mock 样本仅写临时目录，不混入使用者的测评数据。

- `client/`：录音、播放、格式统一、结果/alias/统计页面。
- `providers/`：OpenAI、腾讯、共同超时/错误处理。
- `core/`：fish matching、重量解析、评分和 CSV。
- `backend/`：WAV 校验、Master Data 只读加载、本地存储。
- `server.ts`、`shared/types.ts`、`scripts/`：本地接口、统一类型、构建/刷新命令。
- `test/`、独立 package/lock/config：可复现验证，不修改 ERP package 或依赖。

仓库原有 CI 仍验证 ERP；本工具的独立命令应在本地运行。目前未修改根 CI 配置。
