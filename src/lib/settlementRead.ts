export const SETTLEMENT_READ_TIMEOUT_MS=15_000
export type SettlementReadStage='source'|'settlement'|'legacy'|'master'|'vessels'|'local'
export const settlementReadLabels:Record<SettlementReadStage,string>={
  source:'正在读取称重来源',settlement:'正在读取结单',legacy:'正在核对历史资料',
  master:'正在读取鱼种默认价',vessels:'正在读取船号资料',local:'正在恢复本机草稿',
}

/** Firestore SDK reads may remain pending; settle the UI attempt without trusting late responses. */
export function readSettlementWithDeadline<T>(read:()=>Promise<T>,signal:AbortSignal,stage:()=>SettlementReadStage):Promise<T>{
  return new Promise((resolve,reject)=>{
    if(signal.aborted){reject(new DOMException('读取已取消','AbortError'));return}
    let settled=false
    const finish=(action:()=>void)=>{
      if(settled)return
      settled=true;clearTimeout(timer);signal.removeEventListener('abort',abort);action()
    }
    const abort=()=>finish(()=>reject(new DOMException('读取已取消','AbortError')))
    const timer=setTimeout(()=>finish(()=>reject(new Error(`${settlementReadLabels[stage()].replace('正在','')}较慢，已超过 15 秒。请重新载入；本机草稿已保留。`))),SETTLEMENT_READ_TIMEOUT_MS)
    signal.addEventListener('abort',abort,{once:true})
    Promise.resolve().then(read).then(value=>finish(()=>resolve(value)),error=>finish(()=>reject(error)))
  })
}
