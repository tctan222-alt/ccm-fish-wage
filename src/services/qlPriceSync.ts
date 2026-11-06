import {
  addQlVersion, diffQlVersions, QL_SEED_VERSION, QL_SOURCE, selectQlVersion, validateQlSheet,
  type QlPriceChange, type QlPriceDiff, type QlPriceVersion,
} from '../lib/qlPrices'

export type QlSheetReader = (signal?:AbortSignal)=>Promise<unknown>
export const QL_AUTH_UNAVAILABLE = '尚未配置 ERP 的 Google Sheets 只读授权连接。当前显示已核对的内置版本；请先由负责人批准并配置来源读取授权，再检查更新。'

const isRecord = (value:unknown):value is Record<string,unknown> => !!value&&typeof value==='object'&&!Array.isArray(value)

/** The ERP does not inherit the developer's connected Google Drive credentials. */
export const unavailableQlSheetReader:QlSheetReader = async()=>{ throw new Error(QL_AUTH_UNAVAILABLE) }

/**
 * Integration seam for a separately authorized, in-memory OAuth token provider.
 * Only the approved workbook's metadata and bounded values are read. This does
 * not configure OAuth, persist a token, publish a sheet, or write any prices.
 */
export function createAuthenticatedQlSheetReader(options:{
  getAccessToken:(signal?:AbortSignal)=>Promise<string>
  fetch?:typeof globalThis.fetch
}):QlSheetReader {
  return async signal=>{
    let token:string
    try { token=await options.getAccessToken(signal) }
    catch { throw new Error('Google Sheets 只读授权不可用，请重新连接已批准的来源。') }
    if(!token)throw new Error('Google Sheets 只读授权不可用，请重新连接已批准的来源。')
    const fetchSource=options.fetch??globalThis.fetch
    const base=`https://sheets.googleapis.com/v4/spreadsheets/${QL_SOURCE.spreadsheetId}`
    const get=async(url:string):Promise<unknown>=>{
      let response:Response
      try { response=await fetchSource(url,{method:'GET',headers:{Authorization:`Bearer ${token}`},signal,credentials:'omit',redirect:'error',cache:'no-store'}) }
      catch { throw new Error('无法读取 QL Google Sheet，请检查连接与浏览器来源访问许可后重试。') }
      if(!response.ok){
        if(response.status===401||response.status===403)throw new Error('Google Sheets 只读授权无效或无权读取指定原表。')
        throw new Error('QL Google Sheet 读取失败，请稍后重试。')
      }
      try { return await response.json() }
      catch { throw new Error('QL Google Sheet 返回了无效数据。') }
    }
    const metadata=await get(`${base}?fields=spreadsheetId,properties(title),sheets(properties(title))`)
    if(!isRecord(metadata)||metadata.spreadsheetId!==QL_SOURCE.spreadsheetId||!isRecord(metadata.properties)
      ||typeof metadata.properties.title!=='string'||!Array.isArray(metadata.sheets)
      ||!metadata.sheets.some(sheet=>isRecord(sheet)&&isRecord(sheet.properties)&&sheet.properties.title==='Sheet1'))
      throw new Error('QL 原表标识或工作表已改变，须复核来源。')
    const title=metadata.properties.title
    const datedTitle=/^QL Foods 鱼头价格表 (\d{4}-\d{2}-\d{2})$/.exec(title)
    if(!datedTitle)throw new Error('QL 原表标题缺少明确生效日期，须复核来源。')
    const effectiveDate=datedTitle[1]
    const result=await get(`${base}/values/${encodeURIComponent(QL_SOURCE.range)}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING&majorDimension=ROWS`)
    if(!isRecord(result)||result.range!==QL_SOURCE.range||result.majorDimension!=='ROWS'||!Array.isArray(result.values))
      throw new Error('QL 原表范围或返回格式已改变，须复核来源。')
    const envelope={source:{...QL_SOURCE,title},version:`ql-foods-${effectiveDate}`,effectiveDate,values:result.values}
    // Validate the header's date, every group, cents and arithmetic before any preview.
    validateQlSheet(envelope)
    return envelope
  }
}

export type QlSyncAudit = Readonly<{
  action:'local-preview-staged'
  at:string
  beforeVersion:string|null
  afterVersion:string
  effectiveDate:string
  changes:readonly QlPriceChange[]
}>
export type QlSyncPreview = Readonly<{candidate:QlPriceVersion,diff:QlPriceDiff}>
export type QlSyncState = Readonly<{
  status:'idle'|'checking'|'ready'|'error'
  history:readonly QlPriceVersion[]
  preview:QlSyncPreview|null
  audit:readonly QlSyncAudit[]
  error:string|null
}>

/** In-memory reconciliation only: no Firestore, localStorage or transaction writes. */
export function createQlPriceSync(options:{
  reader?:QlSheetReader
  clock?:()=>Date
  initialVersions?:readonly QlPriceVersion[]
}={}) {
  const reader=options.reader??unavailableQlSheetReader
  const clock=options.clock??(()=>new Date())
  const listeners=new Set<()=>void>()
  let request=0
  let pending:AbortController|null=null
  let previewHistory:readonly QlPriceVersion[]|null=null
  let state:QlSyncState=Object.freeze({status:'idle',history:Object.freeze([...(options.initialVersions??[QL_SEED_VERSION])]),preview:null,audit:Object.freeze([]),error:null})
  const update=(next:QlSyncState)=>{
    state=Object.freeze(next)
    listeners.forEach(listener=>listener())
  }
  const getSnapshot=()=>state
  const subscribe=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener)}}
  const check=async()=>{
    const current=++request
    pending?.abort()
    const controller=new AbortController()
    pending=controller
    update({...state,status:'checking',error:null})
    try {
      const input=await reader(controller.signal)
      if(current!==request)return
      const candidate=validateQlSheet(input)
      // A changed existing date/version is a conflict, never an overwrite preview.
      addQlVersion(state.history,candidate)
      const before=selectQlVersion(state.history,candidate.effectiveDate)
      const diff=diffQlVersions(before,candidate)
      diff.changes.forEach(change=>Object.freeze(change))
      Object.freeze(diff.changes)
      Object.freeze(diff.warnings)
      Object.freeze(diff)
      previewHistory=state.history
      update({...state,status:'ready',preview:Object.freeze({candidate,diff}),error:null})
    } catch(error) {
      if(current!==request)return
      update({...state,status:'error',error:error instanceof Error?error.message:'QL 来源检查失败，请重试。'})
    } finally {
      if(current===request)pending=null
    }
  }
  const stagePreview=()=>{
    if(state.status!=='ready'||!state.preview||previewHistory!==state.history)return false
    const {candidate,diff}=state.preview
    try {
      const history=addQlVersion(state.history,candidate)
      if(history===state.history)return false
      const before=selectQlVersion(state.history,candidate.effectiveDate)
      const entry:QlSyncAudit=Object.freeze({action:'local-preview-staged',at:clock().toISOString(),beforeVersion:before?.version??null,
        afterVersion:candidate.version,effectiveDate:candidate.effectiveDate,changes:diff.changes})
      previewHistory=null
      update({...state,history,audit:Object.freeze([...state.audit,entry]),preview:null,status:'idle',error:null})
      return true
    } catch(error) {
      update({...state,status:'error',error:error instanceof Error?error.message:'QL 本页暂存失败。'})
      return false
    }
  }
  const dispose=()=>{
    ++request
    pending?.abort()
    pending=null
    if(state.status==='checking')update({...state,status:'idle',error:null})
  }
  return {getSnapshot,subscribe,check,stagePreview,dispose}
}
