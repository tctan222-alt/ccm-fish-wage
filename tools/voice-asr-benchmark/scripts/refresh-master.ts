import { fileURLToPath } from 'node:url'
import { fetchMasterData, saveMasterSnapshot } from '../backend/master-data.ts'

const token = process.env.ERP_FIRESTORE_TOKEN?.trim()
if (!token) { console.error('请在本地环境设置 ERP_FIRESTORE_TOKEN；不要在聊天或 Git 中提供凭据。'); process.exitCode = 1 }
else {
  try {
    const fish = await fetchMasterData(token)
    const snapshot = await saveMasterSnapshot(fileURLToPath(new URL('../data/', import.meta.url)), fish)
    console.info(`只读鱼种快照已保存：${fish.length} 个 active fish species，${snapshot.fetchedAt}`)
  } catch { console.error('只读刷新失败。请检查本地 token 和现有读取权限；未输出响应或凭据。'); process.exitCode = 1 }
}
