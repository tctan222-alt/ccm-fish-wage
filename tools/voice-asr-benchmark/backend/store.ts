import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { BenchmarkSample, VoiceAlias } from '../shared/types.ts'

interface State { samples: BenchmarkSample[]; aliases: VoiceAlias[] }
export class LocalStore {
  readonly dataDir: string
  private queue: Promise<unknown> = Promise.resolve()
  constructor(dataDir: string) { this.dataDir = dataDir }
  private async read(): Promise<State> {
    try {
      const value = JSON.parse(await readFile(join(this.dataDir, 'benchmark.json'), 'utf8')) as State
      if (!Array.isArray(value.samples) || !Array.isArray(value.aliases)) throw new Error('Invalid local store')
      return value
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { samples: [], aliases: [] }
      throw new Error('本地 benchmark 数据无法读取；请保留文件并修复，未覆盖原数据。')
    }
  }
  async state(): Promise<State> { await this.queue; return this.read() }
  private mutate(change: (state: State) => void): Promise<void> {
    const operation = this.queue.then(async () => {
      const state = await this.read(); change(state)
      await mkdir(this.dataDir, { recursive: true })
      const path = join(this.dataDir, 'benchmark.json')
      await writeFile(`${path}.tmp`, JSON.stringify(state, null, 2), { mode: 0o600 })
      await rename(`${path}.tmp`, path)
    })
    this.queue = operation.catch(() => undefined)
    return operation
  }
  async saveAudio(sampleId: string, bytes: Uint8Array): Promise<void> {
    if (!/^[0-9a-f-]{36}$/.test(sampleId)) throw new Error('Invalid sample ID')
    await mkdir(join(this.dataDir, 'audio'), { recursive: true })
    await writeFile(join(this.dataDir, 'audio', `${sampleId}.wav`), bytes, { flag: 'wx', mode: 0o600 })
  }
  async addSample(sample: BenchmarkSample): Promise<void> { await this.mutate(state => { state.samples.push(sample) }) }
  async setAlias(phrase: string, fishSpeciesId: string): Promise<void> {
    await this.mutate(state => {
      const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')
      const normalized = normalize(phrase)
      state.aliases = state.aliases.filter(item => normalize(item.phrase) !== normalized)
      state.aliases.push({ phrase, fishSpeciesId, createdAt: new Date().toISOString() })
    })
  }
}
