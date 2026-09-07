import type { BenchmarkSample, FishSpecies, ProviderId, ProviderStatistics } from '../shared/types.ts'
import { normalizeAudio } from './audio.ts'

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const status = el('status'), inputs = el<HTMLFieldSetElement>('inputs'), fishSelect = el<HTMLSelectElement>('fish')
const start = el<HTMLButtonElement>('start'), stop = el<HTMLButtonElement>('stop'), compare = el<HTMLButtonElement>('compare')
const player = el<HTMLAudioElement>('play'), file = el<HTMLInputElement>('file')
let csrfToken = '', fish: FishSpecies[] = [], maxDuration = 45, audio: Blob | null = null, url = ''
let recording: MediaRecorder | null = null, stream: MediaStream | null = null, timer = 0, generation = 0, pending = false
const say = (value: string) => { status.textContent = value }
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error)
async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-benchmark-token': csrfToken }, body: JSON.stringify(body) })
  const data = await response.json()
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : `请求失败：${response.status}`)
  return data as T
}
function node<K extends keyof HTMLElementTagNameMap>(tag: K, text = '') { const result = document.createElement(tag); result.textContent = text; return result }
function choices(select: HTMLSelectElement, blank = false) {
  if (blank) { const option = node('option', '请选择别名对应鱼种'); option.value = ''; select.append(option) }
  for (const item of fish) { const option = node('option', item.displayName); option.value = item.id; select.append(option) }
}
function discard() {
  generation++; audio = null; compare.disabled = true; player.pause(); player.removeAttribute('src'); player.load()
  if (url) URL.revokeObjectURL(url); url = ''; el('audio-info').textContent = '尚无音频'
}
function release() { window.clearTimeout(timer); stream?.getTracks().forEach(track => track.stop()); stream = null }
async function prepare(blob: Blob, current: number) {
  try {
    const result = await normalizeAudio(blob, maxDuration)
    if (current !== generation) return
    audio = result.blob; url = URL.createObjectURL(audio); player.src = url
    el('audio-info').textContent = `${result.duration.toFixed(2)} 秒 · 16 kHz 单声道 WAV · ${audio.size} 字节`
    compare.disabled = false; say('音频已就绪。确认标准答案与服务后开始比较。')
  } catch (error) { if (current === generation) say(`音频处理失败：${errorText(error)}`) }
  finally { if (current === generation) { start.disabled = false; file.disabled = false } }
}
start.onclick = async () => {
  discard(); const current = generation; start.disabled = true; file.disabled = true; say('正在请求麦克风…')
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    if (current !== generation) { release(); return }
    const chunks: BlobPart[] = [], recorder = new MediaRecorder(stream); recording = recorder
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data) }
    recorder.onerror = () => { discard(); release(); recording = null; start.disabled = false; file.disabled = false; stop.disabled = true; say('录音失败，请重新录制。') }
    recorder.onstop = () => { release(); recording = null; stop.disabled = true; if (current === generation) { say('正在本地转换音频…'); void prepare(new Blob(chunks, { type: recorder.mimeType }), current) } }
    recorder.start(); stop.disabled = false; say(`录音中，最多 ${maxDuration} 秒。`)
    timer = window.setTimeout(() => { if (recorder.state === 'recording') recorder.stop() }, maxDuration * 1000)
  } catch (error) { release(); start.disabled = false; file.disabled = false; say(`无法录音：${errorText(error)}。请允许本地页面使用麦克风，或选择音频文件。`) }
}
stop.onclick = () => { if (recording?.state === 'recording') { stop.disabled = true; recording.stop() } }
file.onclick = () => { discard(); file.value = '' }
file.onchange = () => { const selected = file.files?.[0]; if (!selected) return; discard(); if (selected.size > 50 * 1024 * 1024) { say('音频文件不能超过 50 MB，请选择最长 45 秒的片段。'); return }; start.disabled = true; file.disabled = true; say('正在本地转换文件…'); void prepare(selected, generation) }
window.addEventListener('beforeunload', () => { generation++; release(); if (url) URL.revokeObjectURL(url) })

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
      for (const value of [`${row.provider}\n${row.model}`, row.rawTranscript || '—', `${row.parsedFishName ?? '—'} (${row.matchMethod})`, row.parsedWeightKg?.toString() ?? '—', yes(row.fishCorrect), yes(row.weightCorrect), yes(row.wholeBasketCorrect), `${row.latencyMs} ms`, row.error ?? '—']) tr.append(node('td', value))
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
  if (pending || !audio) return
  const providers = [...document.querySelectorAll<HTMLInputElement>('#providers input:checked')].map(input => input.value as ProviderId)
  const expectedWeightKg = el<HTMLInputElement>('weight').value.trim(), expectedFishSpeciesId = fishSelect.value
  if (!expectedFishSpeciesId || !/^\d+(\.\d)?$/.test(expectedWeightKg) || Number(expectedWeightKg) <= 0 || !providers.length) { say('请选择鱼种、至少一个服务，并输入正数重量（最多一位小数）。'); return }
  const snapshot = audio; pending = true; inputs.disabled = true; say('正在比较，请等待…')
  try {
    const bytes = new Uint8Array(await snapshot.arrayBuffer()); let binary = ''
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
    const result = await api<{ sample: BenchmarkSample; samples: BenchmarkSample[]; statistics: ProviderStatistics[] }>('/api/benchmark', { expectedFishSpeciesId, expectedWeightKg, providers, audioBase64: btoa(binary) })
    render(result.samples, result.statistics); say('比较完成，结果已保存。错误结果保留在表格中。')
  } catch (error) { say(`比较失败：${errorText(error)}`) }
  finally { pending = false; inputs.disabled = false }
}
async function init() {
  inputs.disabled = true
  try {
    const config = await api<{ csrfToken: string; providers: { id: ProviderId; label: string; configured: boolean; model: string }[]; maxDurationSeconds: number }>('/api/config')
    csrfToken = config.csrfToken; maxDuration = config.maxDurationSeconds
    const master = await api<{ fish: FishSpecies[]; source: string; fetchedAt: string; error?: string }>('/api/fish'); fish = master.fish.filter(item => item.active); choices(fishSelect)
    for (const provider of config.providers) { const label = node('label'), input = node('input'); input.type = 'checkbox'; input.value = provider.id; input.checked = true; label.append(input, document.createTextNode(`${provider.label} · ${provider.model}${provider.configured ? '' : '（服务端未配置凭据，比较会记录错误）'}`)); el('providers').append(label) }
    const history = await api<{ samples: BenchmarkSample[]; statistics: ProviderStatistics[] }>('/api/samples'); render(history.samples, history.statistics)
    say(`鱼种来源：${master.source} · ${master.fetchedAt}${master.error ? `\n${master.error}` : ''}${fish.length ? '' : '\n没有可用鱼种，请检查服务端主数据配置。'}`)
    inputs.disabled = false
  } catch (error) { say(`初始化失败：${errorText(error)}。请检查本地服务后刷新。`) }
}
void init()
