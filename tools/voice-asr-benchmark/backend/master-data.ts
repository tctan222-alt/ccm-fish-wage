import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { FishSpecies } from '../shared/types.ts'

export const PROJECT_ID = 'ccm-fishery-os-4490d'
export interface FishCatalog { fish: FishSpecies[]; source: string; fetchedAt: string | null; error: string | null }
interface Snapshot { projectId: string; collection: string; fetchedAt: string; fish: FishSpecies[] }
interface FirestoreField { stringValue?: string; booleanValue?: boolean; arrayValue?: { values?: FirestoreField[] } }
interface FirestoreDocument { name?: string; fields?: Record<string, FirestoreField> }

export function activeFish(value: unknown): FishSpecies[] {
  if (!Array.isArray(value)) throw new Error('鱼种快照格式错误。')
  const ids = new Set<string>()
  return value.filter((item): item is FishSpecies => item !== null && typeof item === 'object' && item.active === true
    && typeof item.id === 'string' && item.id.length > 0 && typeof item.displayName === 'string' && item.displayName.trim().length > 0)
    .filter(item => { if (ids.has(item.id)) return false; ids.add(item.id); return true })
    .map(item => ({ id: item.id, displayName: item.displayName.trim(), active: true, voiceAliases: Array.isArray(item.voiceAliases) ? item.voiceAliases.filter(alias => typeof alias === 'string' && alias.trim()).map(alias => alias.trim()) : [] }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, 'zh-Hans'))
}

/** Only GET requests to one fixed collection. Tokens remain in this server process. */
export async function fetchMasterData(token: string, fetchImpl: typeof fetch = fetch): Promise<FishSpecies[]> {
  const fish: FishSpecies[] = []
  let pageToken = ''
  for (let page = 0; page < 100; page++) {
    const url = new URL(`https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/fishSpecies`)
    url.searchParams.set('pageSize', '300')
    if (pageToken) url.searchParams.set('pageToken', pageToken)
    const response = await fetchImpl(url, { method: 'GET', headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(15000) })
    if (!response.ok) throw new Error(`Master Data 只读请求失败（HTTP ${response.status}）。请检查本地 ERP_FIRESTORE_TOKEN。`)
    const body = await response.json() as { documents?: FirestoreDocument[]; nextPageToken?: string }
    for (const document of body.documents ?? []) {
      const fields = document.fields ?? {}
      fish.push({ id: decodeURIComponent(document.name?.split('/').at(-1) ?? ''), displayName: fields.displayName?.stringValue ?? '', active: fields.active?.booleanValue === true,
        voiceAliases: fields.voiceAliases?.arrayValue?.values?.map(item => item.stringValue ?? '').filter(Boolean) ?? [] })
    }
    pageToken = body.nextPageToken ?? ''
    if (!pageToken) return activeFish(fish)
  }
  throw new Error('Master Data 分页超出本地安全上限。')
}

export async function saveMasterSnapshot(dataDir: string, fish: FishSpecies[]): Promise<Snapshot> {
  const snapshot: Snapshot = { projectId: PROJECT_ID, collection: 'fishSpecies', fetchedAt: new Date().toISOString(), fish: activeFish(fish) }
  await mkdir(dataDir, { recursive: true })
  const path = join(dataDir, 'master-data.json')
  await writeFile(`${path}.tmp`, JSON.stringify(snapshot, null, 2), { mode: 0o600 })
  await rename(`${path}.tmp`, path)
  return snapshot
}

export function createMasterLoader(dataDir: string, env: NodeJS.ProcessEnv = process.env, fetchImpl: typeof fetch = fetch): () => Promise<FishCatalog> {
  let cached: FishCatalog | undefined, until = 0
  let pending: Promise<FishCatalog> | undefined
  const load = async (): Promise<FishCatalog> => {
    if (env.ERP_FIRESTORE_TOKEN?.trim()) {
      try {
        const fish = await fetchMasterData(env.ERP_FIRESTORE_TOKEN.trim(), fetchImpl)
        const snapshot = await saveMasterSnapshot(dataDir, fish)
        return { fish, source: `Firestore ${PROJECT_ID}/fishSpecies（只读）`, fetchedAt: snapshot.fetchedAt, error: null }
      } catch {
        // Fail closed instead of silently using stale data after a rejected live refresh.
        return { fish: [], source: 'Firestore 只读加载失败', fetchedAt: null, error: '无法读取鱼种。请检查本地 ERP_FIRESTORE_TOKEN 与读取权限；未回退旧快照。' }
      }
    }
    try {
      const snapshot = JSON.parse(await readFile(join(dataDir, 'master-data.json'), 'utf8')) as Snapshot
      if (snapshot.projectId !== PROJECT_ID || snapshot.collection !== 'fishSpecies' || !Number.isFinite(Date.parse(snapshot.fetchedAt))) throw new Error('Invalid provenance')
      return { fish: activeFish(snapshot.fish), source: 'ERP fishSpecies 本地只读快照（以读取时间为准）', fetchedAt: snapshot.fetchedAt, error: null }
    } catch {
      return { fish: [], source: '尚未加载 ERP Master Data', fetchedAt: null, error: '请在本地设置 ERP_FIRESTORE_TOKEN，或按 README 导入带来源信息的真实 fishSpecies 快照。' }
    }
  }
  return async () => {
    if (cached && Date.now() < until) return cached
    pending ??= load().then(value => { cached = value; until = Date.now() + 60000; return value }).finally(() => { pending = undefined })
    return pending
  }
}
