import { app,auth } from '../firebase'
import { businessDateFromLegacy,legacyIsoDateFromBusinessDate } from '../lib/businessDate'
import type { WeighingProductType as ProductType } from '../lib/weighing'
import type { WeighingSession,WeighingSessionStatus } from '../lib/weighing'

export interface SettlementSearch {
  productType:ProductType
  from:string
  to:string
  vesselId:string
  status:'all'|Exclude<WeighingSessionStatus,'voided'>
}
export interface SettlementSummary {
  id:string
  sessionCode:string
  productType:ProductType
  weighingDate:string
  vesselId:string
  vesselCodeSnapshot:string
  status:WeighingSessionStatus
  basketCount:number
  weightGrams:number
  totalAmountCents:number|null
  referenceNumber:string
  revision:number
  processedReceiptId:string|null
}
type Value={stringValue?:string;integerValue?:string;booleanValue?:boolean;referenceValue?:string;arrayValue?:{values:Value[]}}
export interface ProjectedDocument {name:string;fields:Record<string,Value>}
export interface StructuredQuery {
  select:{fields:{fieldPath:string}[]}
  from:{collectionId:string}[]
  where:{compositeFilter:{op:'AND';filters:unknown[]}}
  orderBy:{field:{fieldPath:string};direction:'DESCENDING'}[]
  limit:number
  startAt?:{values:Value[];before:false}
}
type QueryRunner=(query:StructuredQuery,signal?:AbortSignal)=>Promise<ProjectedDocument[]>
interface Stream {buffer:ProjectedDocument[];after:ProjectedDocument|null;done:boolean}
export interface SettlementCursor {
  fingerprint:string
  iso:Stream
  canonical:Stream
  monthIndex:number
}
export interface SettlementPage {items:SettlementSummary[];cursor:SettlementCursor|null}
export type SettlementPageLoader=(search:SettlementSearch,cursor?:SettlementCursor|null,signal?:AbortSignal)=>Promise<SettlementPage>
const PAGE_SIZE=25
const CANONICAL_QUERY_BUDGET=6
const SESSION_FIELDS=['sessionCode','productType','weighingDate','vesselId','vesselCodeSnapshot','status','revision',
  'fishHeadBasketCount','fishHeadWeightGrams','fishMealBucketBasketCount','fishMealBagBasketCount','fishMealTotalWeightGrams',
  'processedReceiptId','processedReceiptCode','externalSlipNo']
const text=(doc:ProjectedDocument,key:string)=>doc.fields[key]?.stringValue??''
const integer=(doc:ProjectedDocument,key:string)=>Number(doc.fields[key]?.integerValue??0)
const id=(doc:ProjectedDocument)=>decodeURIComponent(doc.name.split('/').at(-1)??'')
const stringValue=(value:string):Value=>({stringValue:value})
const condition=(fieldPath:string,op:string,value:Value)=>({fieldFilter:{field:{fieldPath},op,value}})

export function assertSettlementSearch(search:SettlementSearch){
  for(const date of [search.from,search.to]){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||legacyIsoDateFromBusinessDate(businessDateFromLegacy(date))!==date)throw new Error('请选择有效的开始和结束日期。')
  }
  if(search.from>search.to)throw new Error('开始日期不能晚于结束日期。')
  if(search.productType!=='fish_head'&&search.productType!=='fish_meal')throw new Error('结单类别无效。')
}

function monthsInRange(search:SettlementSearch){
  const months:string[]=[]
  const date=new Date(`${search.to.slice(0,7)}-01T00:00:00Z`)
  while(date.toISOString().slice(0,7)>=search.from.slice(0,7)){
    months.push(date.toISOString().slice(0,7))
    date.setUTCMonth(date.getUTCMonth()-1)
  }
  return months
}

function sessionQuery(search:SettlementSearch,after:ProjectedDocument|null,month?:string):StructuredQuery {
  const filters=[condition('productType','EQUAL',stringValue(search.productType))]
  if(search.vesselId)filters.push(condition('vesselId','EQUAL',stringValue(search.vesselId)))
  filters.push(condition('status',search.status==='all'?'IN':'EQUAL',search.status==='all'?
    {arrayValue:{values:['weighing','completed','processed'].map(stringValue)}}:stringValue(search.status)))
  let from=search.from,to=search.to
  if(month){
    from=from.slice(0,7)===month?from:`${month}-01`
    to=to.slice(0,7)===month?to:new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),0)).toISOString().slice(0,10)
    // Stored date/month pairs are enforced by validWeighingSession in Rules.
    // Equality keeps canonical and ISO streams disjoint even for full-month bounds.
    filters.push(condition('monthKey','EQUAL',stringValue(`${month.slice(5)}/${month.slice(0,4)}`)))
    from=businessDateFromLegacy(from);to=businessDateFromLegacy(to)
  }
  filters.push(condition('weighingDate','GREATER_THAN_OR_EQUAL',stringValue(from)),condition('weighingDate','LESS_THAN_OR_EQUAL',stringValue(to)))
  return {select:{fields:SESSION_FIELDS.map(fieldPath=>({fieldPath}))},from:[{collectionId:'weighingSessions'}],
    where:{compositeFilter:{op:'AND',filters}},orderBy:[{field:{fieldPath:'weighingDate'},direction:'DESCENDING'},{field:{fieldPath:'__name__'},direction:'DESCENDING'}],
    limit:PAGE_SIZE,...(after?{startAt:{values:[stringValue(text(after,'weighingDate')),{referenceValue:after.name}],before:false as const}}:{})}
}

async function runProjectedQuery(query:StructuredQuery,signal?:AbortSignal):Promise<ProjectedDocument[]> {
  const user=auth.currentUser
  if(!user)throw new Error('登录状态已失效，请重新登录。')
  const token=await user.getIdToken()
  const response=await fetch(`https://firestore.googleapis.com/v1/projects/${app.options.projectId}/databases/(default)/documents:runQuery`,{
    method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({structuredQuery:query}),signal,
  })
  if(!response.ok){
    if(response.status===400)throw new Error('结单查询失败：请管理员确认所需 Firestore 索引已建立。')
    if(response.status===401||response.status===403)throw new Error('没有读取结单的权限，请重新登录或联系管理员。')
    throw new Error(`结单服务暂时无法连接（HTTP ${response.status}），请重试。`)
  }
  const results=await response.json() as {document?:ProjectedDocument}[]
  return results.flatMap(result=>result.document?[result.document]:[])
}

function summary(doc:ProjectedDocument,search:SettlementSearch):SettlementSummary {
  if(text(doc,'productType')!==search.productType)throw new Error('结单类别与查询不符，请重试。')
  return {id:id(doc),sessionCode:text(doc,'sessionCode'),productType:search.productType,weighingDate:text(doc,'weighingDate'),
    vesselId:text(doc,'vesselId'),vesselCodeSnapshot:text(doc,'vesselCodeSnapshot'),status:text(doc,'status') as WeighingSessionStatus,
    basketCount:search.productType==='fish_head'?integer(doc,'fishHeadBasketCount'):integer(doc,'fishMealBucketBasketCount')+integer(doc,'fishMealBagBasketCount'),
    weightGrams:integer(doc,search.productType==='fish_head'?'fishHeadWeightGrams':'fishMealTotalWeightGrams'),
    totalAmountCents:null,referenceNumber:text(doc,'processedReceiptCode')||text(doc,'externalSlipNo'),revision:integer(doc,'revision'),processedReceiptId:text(doc,'processedReceiptId')||null}
}

function amountsQuery(collectionId:string,fieldPath:string,values:Value[],fields:string[]):StructuredQuery {
  return {select:{fields:fields.map(fieldPath=>({fieldPath}))},from:[{collectionId}],
    where:{compositeFilter:{op:'AND',filters:[condition(fieldPath,'IN',{arrayValue:{values}})]}},orderBy:[],limit:PAGE_SIZE+1}
}

export function createSettlementPageLoader(run:QueryRunner=runProjectedQuery):SettlementPageLoader {
  return async(search,cursor,signal)=>{
    assertSettlementSearch(search)
    const fingerprint=JSON.stringify(search)
    if(cursor&&cursor.fingerprint!==fingerprint)throw new Error('筛选已改变，请重新查询。')
    const state:SettlementCursor=cursor?{
      ...cursor,iso:{...cursor.iso,buffer:[...cursor.iso.buffer]},canonical:{...cursor.canonical,buffer:[...cursor.canonical.buffer]},
    }:{fingerprint,iso:{buffer:[],after:null,done:false},canonical:{buffer:[],after:null,done:false},monthIndex:0}
    const months=monthsInRange(search)
    async function fillIso(){
      if(state.iso.buffer.length||state.iso.done)return
      const docs=await run(sessionQuery(search,state.iso.after),signal)
      state.iso.buffer=docs;state.iso.done=docs.length<PAGE_SIZE
      state.iso.after=docs.at(-1)??state.iso.after
    }
    let canonicalQueries=0
    async function fillCanonical(newestIsoMonth?:string){
      while(!state.canonical.buffer.length&&!state.canonical.done){
        if(state.monthIndex>=months.length){state.canonical.done=true;break}
        // Older canonical months cannot outrank the next ISO row. Defer these
        // empty-month probes until needed instead of scanning a large range before page one.
        if(newestIsoMonth&&months[state.monthIndex]<newestIsoMonth)break
        if(canonicalQueries>=CANONICAL_QUERY_BUDGET)return false
        canonicalQueries++
        const docs=await run(sessionQuery(search,state.canonical.after,months[state.monthIndex]),signal)
        state.canonical.buffer=docs
        state.canonical.after=docs.at(-1)??state.canonical.after
        if(docs.length<PAGE_SIZE){state.monthIndex++;state.canonical.after=null}
        if(state.monthIndex>=months.length)state.canonical.done=true
      }
      return true
    }
    const documents:ProjectedDocument[]=[]
    while(documents.length<PAGE_SIZE){
      signal?.throwIfAborted()
      await fillIso()
      const newestIso=state.iso.buffer[0]
      const canonicalReady=await fillCanonical(newestIso?legacyIsoDateFromBusinessDate(businessDateFromLegacy(text(newestIso,'weighingDate'))).slice(0,7):undefined)
      // Return a resumable partial page instead of hiding results behind hundreds
      // of empty-month requests. Never emit ISO rows ahead of unchecked newer months.
      if(!canonicalReady)break
      const iso=state.iso.buffer[0],canonical=state.canonical.buffer[0]
      if(!iso&&!canonical)break
      const order=(doc:ProjectedDocument)=>legacyIsoDateFromBusinessDate(businessDateFromLegacy(text(doc,'weighingDate')))
      const chooseIso=iso&&(!canonical||order(iso)>order(canonical)||order(iso)===order(canonical)&&iso.name>canonical.name)
      documents.push((chooseIso?state.iso:state.canonical).buffer.shift()!)
    }
    const items=documents.map(doc=>summary(doc,search))
    if(items.length){
      // Only projected monetary headers are fetched in batches. Never fetch source baskets, species or draft lines here.
      const receipts=items.filter(item=>item.processedReceiptId)
      const [drafts,receiptHeaders]=await Promise.all([
        run(amountsQuery('purchaseSettlementDrafts','sourceSessionId',items.map(item=>stringValue(item.id)),
          ['sourceSessionId','sourceSessionRevision','productType','totalAmountCents','receiptNo','voided']),signal),
        receipts.length?run(amountsQuery('purchaseReceipts','__name__',receipts.map(item=>({referenceValue:`projects/${app.options.projectId}/databases/(default)/documents/purchaseReceipts/${item.processedReceiptId}`})),
          ['totalAmountCents','receiptCode']),signal):Promise.resolve([]),
      ])
      if(drafts.length>PAGE_SIZE)throw new Error('结单草稿数量异常，请管理员核对来源身份。')
      for(const item of items){
        const receipt=receiptHeaders.find(doc=>id(doc)===item.processedReceiptId)
        const matching=drafts.filter(doc=>text(doc,'sourceSessionId')===item.id&&text(doc,'productType')===search.productType&&integer(doc,'sourceSessionRevision')===item.revision&&doc.fields.voided?.booleanValue!==true)
        if(matching.length>1)throw new Error('同一现场单有多个结单草稿，请管理员核对。')
        const amount=receipt??matching[0]
        if(amount&&amount.fields.totalAmountCents?.integerValue!==undefined){
          const cents=integer(amount,'totalAmountCents')
          if(!Number.isSafeInteger(cents)||cents<0)throw new Error('结单金额无效，请管理员核对。')
          item.totalAmountCents=cents
          item.referenceNumber=text(amount,receipt?'receiptCode':'receiptNo')||item.referenceNumber
        }
      }
    }
    const more=state.iso.buffer.length||state.canonical.buffer.length||!state.iso.done||!state.canonical.done
    return {items,cursor:more?state:null}
  }
}
export const loadSettlementPage=createSettlementPageLoader()

// Local fixture adapter for page tests; production always uses the bounded projected query above.
export function settlementSummaryFromSession(session:WeighingSession):SettlementSummary {
  return {id:session.id,sessionCode:session.sessionCode,productType:session.productType as ProductType,weighingDate:session.weighingDate,
    vesselId:session.vesselId,vesselCodeSnapshot:session.vesselCodeSnapshot,status:session.status,
    basketCount:session.productType==='fish_head'?session.fishHeadBasketCount:session.fishMealBucketBasketCount+session.fishMealBagBasketCount,
    weightGrams:session.productType==='fish_head'?session.fishHeadWeightGrams:session.fishMealTotalWeightGrams,
    totalAmountCents:null,referenceNumber:session.processedReceiptCode||session.externalSlipNo,revision:session.revision,processedReceiptId:session.processedReceiptId}
}
