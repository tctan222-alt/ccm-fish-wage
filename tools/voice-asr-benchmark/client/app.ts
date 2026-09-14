import type { BenchmarkSample, FishSpecies, ProviderId, ProviderStatistics } from '../shared/types.ts'
import { normalizeAudio } from './audio.ts'

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const status = el('status'), inputs = el<HTMLFieldSetElement>('inputs'), fishSelect = el<HTMLSelectElement>('fish')
const start = el<HTMLButtonElement>('start'), stop = el<HTMLButtonElement>('stop'), compare = el<HTMLButtonElement>('compare')
const player = el<HTMLAudioElement>('play'), file = el<HTMLInputElement>('file')
const weightInput = el<HTMLInputElement>('weight'), refresh = el<HTMLButtonElement>('refresh')
const providerIds: ProviderId[] = ['openai', 'tencent']
const providerName = (id: ProviderId) => id === 'openai' ? 'OpenAI' : 'Tencent'
const providerInput = (id: ProviderId) => el<HTMLInputElement>(`provider-${id}`)
const configured: Record<ProviderId, boolean> = { openai: false, tencent: false }
let csrfToken = '', fish: FishSpecies[] = [], maxDuration = 45, audio: Blob | null = null, url = ''
let recording: MediaRecorder | null = null, stream: MediaStream | null = null, timer = 0, generation = 0, pending = false
let connected = false, checkedHealth = false, checking = false, connectionError = '正在检查本地识别服务。', setupError = ''
let audioState: 'empty' | 'requesting' | 'recording' | 'processing' | 'ready' | 'error' = 'empty', duration = 0, audioError = ''
const say = (value: string) => { status.textContent = value }
const errorText = (error: unknown) => error instanceof Error && /[\u3400-\u9fff]/u.test(error.message) ? error.message : '本地操作失败，请检查服务后重试。'
class ApiError extends Error {
  readonly status: number
  constructor(message: string, status = 0) { super(message); this.status = status }
}
const selectedProviders = () => providerIds.filter(id => configured[id] && providerInput(id).checked)
function reasons(): string[] {
  if (pending) return ['比较中...']
  const result: string[] = []
  if (checking) result.push('正在检查本地识别服务，请稍候。')
  if (!connected) result.push(connectionError)
  else if (setupError || !csrfToken) result.push(setupError || '本地接口尚未就绪，请重新检查连接。')
  if (connected && !providerIds.some(id => configured[id])) result.push('尚未配置任何语音识别服务')
  else if (connected && !selectedProviders().length) result.push('请至少选择一个可用的语音识别服务。')
  if (!audio || audioState !== 'ready') result.push(audioState === 'recording' ? '请先停止录音。' : audioState === 'processing' ? '音频转换中，请稍候。' : audioState === 'requesting' ? '请允许麦克风访问或选择音频文件。' : '请先录音（或选择音频文件）。')
  if (!fish.some(item => item.id === fishSelect.value && item.active)) result.push('请选择有效鱼种。')
  const weight = weightInput.value.trim(), value = Number(weight)
  if (!weight) result.push('请输入预期重量 kg。')
  else if (!/^\d+(?:\.\d)?$/.test(weight) || value <= 0 || !Number.isSafeInteger(Math.round(value * 10))) result.push('预期重量须为正数，最多 1 位小数。')
  return result
}
function syncControls() {
  el('server-status').textContent = connected ? '已连接' : checkedHealth ? '未连接' : '正在检查'
  for (const id of providerIds) {
    el(`${id}-status`).textContent = connected ? configured[id] ? '可用' : '未配置' : '无法确认（服务未连接）'
    providerInput(id).disabled = pending || !connected || !configured[id]
  }
  inputs.disabled = pending
  start.disabled = pending || ['requesting', 'recording', 'processing'].includes(audioState)
  file.disabled = start.disabled
  stop.disabled = pending || audioState !== 'recording'
  refresh.disabled = checking || pending
  refresh.textContent = checking ? '检查连接中...' : '重新检查连接'
  const blockers = reasons()
  compare.disabled = blockers.length > 0
  compare.textContent = pending ? '比较中...' : '开始比较'
  el('compare-reason').textContent = blockers.length ? blockers.join('\n') : `已就绪：将同一段音频发送至 ${selectedProviders().map(providerName).join('、')}。`
  el('audio-info').textContent = audioState === 'ready' ? `录音：已录音 ${duration.toFixed(2)} 秒 · 16 kHz 单声道 WAV · ${audio?.size} 字节`
    : audioState === 'recording' ? `录音：录音中（最多 ${maxDuration} 秒）` : audioState === 'processing' ? '录音：正在生成有效音频...'
      : audioState === 'requesting' ? '录音：等待麦克风权限' : `录音：未录音${audioError ? ` · ${audioError}` : ''}`
}
async function api<T>(path: string, body?: unknown): Promise<T> {
  const controller = new AbortController()
  const deadline = window.setTimeout(() => controller.abort(), path === '/api/benchmark' ? 150000 : 5000)
  try {
    let response: Response
    try { response = await fetch(path, { signal: controller.signal, ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-benchmark-token': csrfToken }, body: JSON.stringify(body) }) }) }
    catch {
      connected = false; checkedHealth = true
      connectionError = controller.signal.aborted ? '本地识别服务响应超时，请检查服务后重试。' : '无法连接本地识别服务。请在本工具目录运行 npm.cmd start，再点「重新检查连接」。'
      syncControls(); throw new ApiError(connectionError)
    }
    let data: { error?: string }
    try { data = await response.json() }
    catch { throw new ApiError(`本地服务返回无效响应（HTTP ${response.status}），请重启本地服务。`, response.status) }
    if (!response.ok) throw new ApiError(`${typeof data.error === 'string' ? data.error : '本地请求失败'}（HTTP ${response.status}）`, response.status)
    return data as T
  } finally { window.clearTimeout(deadline) }
}
function node<K extends keyof HTMLElementTagNameMap>(tag: K, text = '') { const result = document.createElement(tag); result.textContent = text; return result }
function choices(select: HTMLSelectElement, blank = false) {
  if (blank) { const option = node('option', '请选择别名对应鱼种'); option.value = ''; select.append(option) }
  for (const item of fish) { const option = node('option', item.displayName); option.value = item.id; select.append(option) }
}
function discard() {
  generation++; audio = null; duration = 0; audioState = 'empty'; audioError = ''; player.pause(); player.removeAttribute('src'); player.load()
  if (url) URL.revokeObjectURL(url); url = ''
}
function release() { window.clearTimeout(timer); stream?.getTracks().forEach(track => track.stop()); stream = null }
async function prepare(blob: Blob, current: number) {
  audioState = 'processing'; syncControls()
  try {
    const result = await normalizeAudio(blob, maxDuration)
    if (current !== generation) return
    if (result.blob.size <= 44 || result.duration <= 0) throw new Error('录音为空，请重新录音。')
    audio = result.blob; duration = result.duration; audioState = 'ready'; url = URL.createObjectURL(audio); player.src = url
    say('音频已就绪。请按比较按钮旁的提示完成标准答案与服务配置。')
  } catch (error) {
    if (current === generation) { audioState = 'error'; audioError = error instanceof Error && /[\u3400-\u9fff]/u.test(error.message) ? error.message : '无法解码音频，请重新录音或选择支持的音频文件。'; say(`音频处理失败：${audioError}`) }
  } finally { if (current === generation) syncControls() }
}
start.onclick = async () => {
  discard(); const current = generation; audioState = 'requesting'; syncControls(); say('正在请求麦克风…')
  try {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('当前浏览器不支持录音，请改用 Chrome/Edge 或选择音频文件。')
    const captured = await navigator.mediaDevices.getUserMedia({ audio: true })
    if (current !== generation) { captured.getTracks().forEach(track => track.stop()); return }
    stream = captured
    const chunks: BlobPart[] = [], recorder = new MediaRecorder(captured); recording = recorder
    let ownTimer = 0
    const closeCapture = () => {
      window.clearTimeout(ownTimer); captured.getTracks().forEach(track => track.stop())
      if (stream === captured) stream = null
      if (recording === recorder) recording = null
    }
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data) }
    recorder.onerror = () => { closeCapture(); if (current !== generation) return; discard(); audioState = 'error'; audioError = '录音失败，请重新录音。'; say(audioError); syncControls() }
    recorder.onstop = () => { closeCapture(); if (current === generation) { say('正在本地转换音频…'); void prepare(new Blob(chunks, { type: recorder.mimeType }), current) } }
    recorder.start(); audioState = 'recording'; syncControls(); say(`录音中，最多 ${maxDuration} 秒。`)
    ownTimer = window.setTimeout(() => { if (recorder.state === 'recording') recorder.stop() }, maxDuration * 1000); timer = ownTimer
  } catch (error) {
    if (current !== generation) return
    release(); recording = null; audioState = 'error'; audioError = error instanceof Error && /[\u3400-\u9fff]/u.test(error.message) ? error.message : '请允许本地页面使用麦克风，或选择音频文件。'
    say(`无法录音：${audioError}`); syncControls()
  }
}
stop.onclick = () => { if (recording?.state === 'recording') { stop.disabled = true; recording.stop() } }
file.onclick = () => { file.value = '' }
file.onchange = () => {
  const selected = file.files?.[0]; if (!selected) return
  discard()
  if (selected.size > 50 * 1024 * 1024) { audioState = 'error'; audioError = '音频文件不能超过 50 MB，请选择最长 45 秒的片段。'; say(audioError); syncControls(); return }
  say('正在本地转换文件…'); void prepare(selected, generation)
}

function providerError(code: string | null): string {
  if (!code) return '—'
  if (code.startsWith('weight parse error:')) return code.replace('weight parse error:', '重量解析错误：')
  if (code === 'NOT_CONFIGURED') return 'API 尚未配置，请在本机配置并重启服务。'
  if (code === 'TIMEOUT') return '识别请求超时，请检查网络后重试。'
  if (code === 'HTTP_401' || code === 'HTTP_403' || code.startsWith('AuthFailure')) return `识别服务身份验证失败，请检查本地凭据与权限（${code}）。`
  if (code === 'HTTP_429' || code.startsWith('LimitExceeded')) return `识别服务限额或频率受限（${code}）。`
  if (code === 'INVALID_AUDIO') return '音频格式无效，请重新录音。'
  if (code === 'INVALID_RESPONSE') return '识别服务返回了无效响应。'
  if (code === 'REQUEST_FAILED' || code === 'provider_request_failed') return '识别请求失败，请检查本地网络和服务配置。'
  return `识别服务返回错误（${code}）。`
}
function render(samples: BenchmarkSample[], statistics: ProviderStatistics[]) {
  const stats = el('statistics'); stats.replaceChildren(); stats.className = 'stats'
  const percent = (value: number) => `${(value * 100).toFixed(1)}%`
  for (const item of statistics) stats.append(node('p', `${item.provider}：${item.samples} 次，错误 ${item.errors} 次\n鱼种 ${percent(item.fishAccuracy)} · 重量 ${percent(item.weightAccuracy)} · 整篮 ${percent(item.wholeBasketAccuracy)}\n平均耗时 ${item.averageLatencyMs === null ? '—' : `${Math.round(item.averageLatencyMs)} ms`}`))
  if (!statistics.length) stats.append(node('p', '尚无已保存测试。'))
  const results = el('results'); results.replaceChildren()
  for (const sample of [...samples].reverse()) {
    const article = node('article'); article.append(node('h3', `${sample.expectedFishName} · ${sample.expectedWeightKg} kg`), node('small', `${sample.createdAt} · ${sample.sampleId} · 音频 SHA256 ${sample.audio.sha256}`))
    const wrap = node('div'); wrap.className = 'table-wrap'; const table = node('table'), header = node('tr')
    for (const title of ['Provider / 模型', '原始识别', '鱼名候选', '重量 kg', '鱼名正确', '重量正确', '整篮正确', '耗时', '错误']) header.append(node('th', title))
    const head = node('thead'); head.append(header); table.append(head); const body = node('tbody')
    for (const row of sample.results) {
      const tr = node('tr'), yes = (value: boolean) => value ? '是' : '否'
      for (const value of [`${providerName(row.provider)}\n${row.model}`, row.rawTranscript || '—', `${row.parsedFishName ?? '—'} (${row.matchMethod})`, row.parsedWeightKg?.toString() ?? '—', yes(row.fishCorrect), yes(row.weightCorrect), yes(row.wholeBasketCorrect), `${row.latencyMs} ms`, providerError(row.error)]) tr.append(node('td', value))
      body.append(tr)
      const alias = node('div'); alias.className = 'alias'; alias.append(node('strong', `${row.provider} 语音别名`))
      const phraseLabel = node('label', '识别鱼名短语'), phrase = node('input'); phrase.value = row.rawFishPhrase; phrase.maxLength = 100; phraseLabel.append(phrase)
      const targetLabel = node('label', '对应鱼种'), target = node('select'); choices(target, true); targetLabel.append(target)
      const save = node('button', '记为语音别名'), feedback = node('p'); feedback.setAttribute('role', 'status')
      save.onclick = async () => {
        if (!phrase.value.trim() || !target.value) { feedback.textContent = '请输入短语并明确选择对应鱼种。'; return }
        save.disabled = true; phrase.disabled = true; target.disabled = true
        try { await api('/api/aliases', { phrase: phrase.value.trim(), fishSpeciesId: target.value }); feedback.textContent = '别名已保存，仅影响未来测试；历史评分不变。' }
        catch (error) { feedback.textContent = errorText(error) }
        finally { save.disabled = false; phrase.disabled = false; target.disabled = false }
      }
      alias.append(phraseLabel, targetLabel, save, feedback)
      for (const candidate of row.fishSuggestions.slice(0, 3)) {
        if (!fish.some(item => item.id === candidate.id)) continue
        const button = node('button', `别名目标：${candidate.displayName}`); button.onclick = () => { if (!target.disabled) target.value = candidate.id }; alias.append(button)
      }
      article.append(alias)
    }
    table.append(body); wrap.append(table); article.insertBefore(wrap, article.children[2] ?? null); results.append(article)
  }
}
compare.onclick = async () => {
  const blockers = reasons()
  if (blockers.length || !audio) { say(`暂时无法比较：${blockers.join('；') || '请先录音。'}`); syncControls(); return }
  const providers = selectedProviders(), expectedWeightKg = weightInput.value.trim(), expectedFishSpeciesId = fishSelect.value
  const snapshot = audio; pending = true; syncControls(); say('比较中...')
  let refreshConfig = false
  try {
    const bytes = new Uint8Array(await snapshot.arrayBuffer()); let binary = ''
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
    const result = await api<{ sample: BenchmarkSample; samples: BenchmarkSample[]; statistics: ProviderStatistics[] }>('/api/benchmark', { expectedFishSpeciesId, expectedWeightKg, providers, audioBase64: btoa(binary) })
    render(result.samples, result.statistics)
    const failures = result.sample.results.filter(row => row.error)
    say(failures.length ? `比较完成，部分或全部识别失败：\n${failures.map(row => `${providerName(row.provider)}：${providerError(row.error)}`).join('\n')}\n已保留结果，请查看表格。` : '比较完成，结果已保存。')
  } catch (error) { say(`比较失败：${errorText(error)}\n若请求途中断开，请先检查历史结果，再决定是否重试。`); refreshConfig = error instanceof ApiError && (error.status === 403 || error.status === 503) }
  finally { pending = false; syncControls(); if (refreshConfig) await checkConnection(true) }
}
async function loadSetup() {
  setupError = ''
  try {
    const config = await api<{ csrfToken: string; maxDurationSeconds: number }>('/api/config')
    if (typeof config.csrfToken !== 'string' || !config.csrfToken || !Number.isFinite(config.maxDurationSeconds)) throw new Error('本地接口配置无效，请重启服务。')
    csrfToken = config.csrfToken; maxDuration = config.maxDurationSeconds
    const master = await api<{ fish: FishSpecies[]; source: string; fetchedAt: string | null; error?: string }>('/api/fish')
    const previousFish = fishSelect.value; fish = master.fish.filter(item => item.active); fishSelect.replaceChildren(); choices(fishSelect)
    if (fish.some(item => item.id === previousFish)) fishSelect.value = previousFish
    el('master-info').textContent = `鱼种来源：${master.source} · ${master.fetchedAt ?? '未读取'}${master.error ? `\n${master.error}` : ''}`
    if (master.error || !fish.length) setupError = master.error || '没有可用鱼种，请检查本地鱼种快照。'
  } catch (error) { setupError = `本地接口加载失败：${errorText(error)}`; say(setupError) }
  try {
    const history = await api<{ samples: BenchmarkSample[]; statistics: ProviderStatistics[] }>('/api/samples'); render(history.samples, history.statistics)
    el('history-status').textContent = ''
  } catch (error) { el('history-status').textContent = `历史结果加载失败：${errorText(error)}` }
}
async function checkConnection(reloadData = false, announce = false) {
  if (checking || pending) return
  checking = true; syncControls()
  const wasConnected = connected
  try {
    const health = await api<{ ok: boolean; providers: Record<ProviderId, { configured: boolean }> }>('/api/health')
    if (health.ok !== true || providerIds.some(id => typeof health.providers?.[id]?.configured !== 'boolean')) throw new Error('本地服务健康检查响应无效，请重启本地服务。')
    connected = true; connectionError = ''
    for (const id of providerIds) {
      const value = health.providers[id].configured
      if (!checkedHealth || (!configured[id] && value)) providerInput(id).checked = value
      if (!value) providerInput(id).checked = false
      configured[id] = value
    }
    if (reloadData || !wasConnected || !csrfToken) await loadSetup()
    if (announce) say(connected ? '服务检查完成。请按比较按钮旁的提示操作。' : connectionError)
  } catch (error) {
    connected = false
    connectionError = error instanceof ApiError && error.status === 404 ? '本地服务版本不匹配：缺少 /api/health，请重启本工具服务。' : errorText(error)
    say(connectionError)
  } finally { checkedHealth = true; checking = false; syncControls() }
}
fishSelect.onchange = syncControls
weightInput.oninput = syncControls
for (const id of providerIds) providerInput(id).onchange = syncControls
refresh.onclick = () => { void checkConnection(true, true) }
const healthPoll = window.setInterval(() => { void checkConnection() }, 10000)
window.addEventListener('beforeunload', () => { generation++; window.clearInterval(healthPoll); release(); if (url) URL.revokeObjectURL(url) })
syncControls()
void checkConnection(true, true)
