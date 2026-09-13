import { useEffect,useMemo,useRef,useState } from 'react'
import { Link,useParams } from 'react-router-dom'
import { businessDateFromLegacy,legacyIsoDateFromBusinessDate,malaysiaBusinessDate,monthKeyFromBusinessDate,monthSortKeyFromMonthKey,sortKeyFromBusinessDate } from '../lib/businessDate'
import { buildPurchaseSettlementLines,formatSettlementMoney,makeSettlementDraft,reconcileSettlementLines,updateSettlementLinePrice,totalSettlementAmountCents,type PurchaseSettlementDraft,type PurchaseSettlementLine,asSettlementSourceEntry } from '../lib/purchaseSettlement'
import { canModifyWeighing,formatWeightKg,type WeighingEntry,type WeighingProductType,type WeighingSession } from '../lib/weighing'
import type { Vessel } from '../lib/purchasing'
import { loadVessels } from '../services/purchaseMasterData'
import { loadPurchaseSettlementDraft,loadPurchaseSettlementSource,savePurchaseSettlementDraft,type PurchaseSettlementSource } from '../services/purchaseSettlements'
import { loadWeighingBundle } from '../services/weighing'

function lineKey(line:PurchaseSettlementLine){return line.sourceEntryIds.join('|')}
function priceText(value:number|null){return value===null?'':(value/100).toFixed(2)}
function dateInputValue(value:string){try{return legacyIsoDateFromBusinessDate(value)}catch{return ''}}
function mealCountText(line:PurchaseSettlementLine){
  const totalRecords=line.totalWeightEntryCount-line.basketCount
  return [
    line.basketCount>0?`${line.basketCount}篮`:null,
    totalRecords>0?`总重 ${totalRecords} 条`:null,
  ].filter(Boolean).join(' / ')
}

export function PurchaseSettlementPage({
  productType,
  vesselLoader=loadVessels,
  sourceLoader=loadPurchaseSettlementSource,
  draftLoader=loadPurchaseSettlementDraft,
  draftSaver=savePurchaseSettlementDraft,
  bundleLoader=loadWeighingBundle,
  today=malaysiaBusinessDate,
  now=()=>new Date(),
}: {
  productType:WeighingProductType
  vesselLoader?:()=>Promise<Vessel[]>
  sourceLoader?:(vesselId:string,businessDate:string,productType:WeighingProductType)=>Promise<PurchaseSettlementSource>
  draftLoader?:(productType:WeighingProductType,dateSortKey:number,vesselId:string)=>Promise<PurchaseSettlementDraft|null>
  draftSaver?:(draft:PurchaseSettlementDraft)=>Promise<PurchaseSettlementDraft>
  bundleLoader?:(sessionId:string)=>Promise<{session:WeighingSession;entries:WeighingEntry[]}>
  today?:()=>string
  now?:()=>Date
}){
  const {sessionId}=useParams()
  const fishHead=productType==='fish_head'
  const [vessels,setVessels]=useState<Vessel[]>([]),[vesselId,setVesselId]=useState(''),[businessDate,setBusinessDate]=useState(today())
  const [entries,setEntries]=useState<WeighingEntry[]>([]),[lines,setLines]=useState<PurchaseSettlementLine[]>([])
  const [receiptNo,setReceiptNo]=useState(''),[priceInputs,setPriceInputs]=useState<Record<string,string>>({}),[error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false)
  const [loading,setLoading]=useState(true)
  const [sourceSession,setSourceSession]=useState<WeighingSession|null>(null)
  const [loadedKey,setLoadedKey]=useState(''),[draftRevision,setDraftRevision]=useState(0)
  const saveLock=useRef(false)
  const requestedVesselId=sessionId?'':vesselId,requestedDate=sessionId?'':businessDate
  const contextKey=sessionId?`${productType}:${sessionId}`:`${productType}:${vesselId}:${businessDate}`
  const ready=!loading&&loadedKey===contextKey
  const editable=ready&&Boolean(sourceSession&&canModifyWeighing(sourceSession,now()))

  useEffect(()=>{let cancelled=false;void vesselLoader().then(items=>{if(cancelled)return;setVessels(items);if(!sessionId)setVesselId(current=>current||items.find(item=>item.active)?.id||'')}).catch(()=>{if(!cancelled)setError('无法载入船号资料，仍可查看指定的历史结单。')});return()=>{cancelled=true}},[vesselLoader,sessionId])

  useEffect(()=>{
    if(!sessionId&&!requestedVesselId){setLoading(false);return}
    let cancelled=false
    setLoading(true);setLoadedKey('');setLines([]);setEntries([]);setSourceSession(null);setError('');setMessage('')
    void (async()=>{
      const source=sessionId?await bundleLoader(sessionId):(await sourceLoader(requestedVesselId,requestedDate,productType)).bundle
      if(source?.session.productType&&source.session.productType!==productType)throw new Error('结单类型与来源称重单不一致。')
      const date=source?businessDateFromLegacy(source.session.weighingDate):requestedDate
      const sourceVesselId=source?.session.vesselId??requestedVesselId
      const draft=await draftLoader(productType,sortKeyFromBusinessDate(date),sourceVesselId)
      if(cancelled)return
      if(draft?.sourceSessionId&&source&&draft.sourceSessionId!==source.session.id)throw new Error('结单关联了另一张称重单，请核查来源。')
      const sourceEntries=source?.entries??[]
      const built=buildPurchaseSettlementLines(sourceEntries.map(asSettlementSourceEntry),productType,source?.session.vesselCodeSnapshot??'')
      const nextLines=source?(draft?reconcileSettlementLines(built,draft.lines):built):(draft?.lines??[])
      setSourceSession(source?.session??null);setEntries(sourceEntries);setReceiptNo(draft?.receiptNo??source?.session.externalSlipNo??'');setDraftRevision(draft?.revision??0)
      setLines(nextLines);setPriceInputs(Object.fromEntries(nextLines.map(line=>[lineKey(line),priceText(line.unitPriceCentsPerKg)])))
      if(sessionId){setVesselId(sourceVesselId);setBusinessDate(date)}
      setLoadedKey(contextKey)
    })().catch(problem=>{if(!cancelled)setError(problem instanceof Error?problem.message:'无法载入结单资料。')}).finally(()=>{if(!cancelled)setLoading(false)})
    return()=>{cancelled=true}
  },[requestedVesselId,requestedDate,productType,sourceLoader,draftLoader,bundleLoader,sessionId,contextKey])

  const selectedVessel=vessels.find(item=>item.id===vesselId)
  const total=useMemo(()=>totalSettlementAmountCents(lines),[lines])
  const sourceEntryCount=entries.filter(item=>!item.voided&&item.productType===productType).length
  function changePrice(line:PurchaseSettlementLine,value:string){
    const key=lineKey(line);setPriceInputs(current=>({...current,[key]:value}));
    try{const updated=updateSettlementLinePrice(line,value);setLines(current=>current.map(item=>lineKey(item)===key?updated:item));setError('')}
    catch(problem){setError(problem instanceof Error?problem.message:'单价格式不正确。')}
  }
  async function saveDraft(){
    if(saveLock.current)return
    if(!editable||!sourceSession||!canModifyWeighing(sourceSession,now())||lines.length===0){setError('当前结单只读，不能保存修改。');return}
    try{
      saveLock.current=true;setBusy(true);setError('')
      const validatedLines=lines.map(line=>({...updateSettlementLinePrice(line,priceInputs[lineKey(line)]??''),priceWasEdited:line.priceWasEdited}))
      const monthKey=monthKeyFromBusinessDate(businessDate)
      const saved=await draftSaver({...makeSettlementDraft({productType,businessDate,dateSortKey:sortKeyFromBusinessDate(businessDate),monthKey,monthSortKey:monthSortKeyFromMonthKey(monthKey),
        vesselId:sourceSession.vesselId,vesselCodeSnapshot:sourceSession.vesselCodeSnapshot,receiptNo:receiptNo.trim(),lines:validatedLines,sourceEntryIds:entries.filter(item=>!item.voided&&item.productType===productType).map(item=>item.id),revision:draftRevision}),
        sourceSessionId:sourceSession.id,sourceSessionRevision:sourceSession.revision})
      setDraftRevision(saved.revision)
      setMessage(`结单草稿已保存（第 ${saved.revision} 版）。`)
    }catch(problem){setError(problem instanceof Error?problem.message:'无法保存结单草稿。')}finally{setBusy(false);saveLock.current=false}
  }
  async function copyTable(){
    const header=fishHead?'鱼名\t总重量\t篮数\t预设价\t单价 RM/kg\t金额':'品质\t总重量\t篮数/总重记录\t预设价\t单价 RM/kg\t金额'
    const rows=lines.map(line=>[line.nameSnapshot,`${formatWeightKg(line.totalWeightGrams)} kg`,fishHead?`${line.basketCount}篮`:mealCountText(line),priceText(line.defaultUnitPriceCentsPerKg)||'-',priceText(line.unitPriceCentsPerKg),formatSettlementMoney(line.amountCents)].join('\t'))
    try{await navigator.clipboard?.writeText([header,...rows,`总额\t${formatSettlementMoney(total)}`].join('\n'));setMessage('表格已复制，可以贴到 Excel。')}catch{setError('无法复制表格，请手动选择复制。')}
  }
  return <main className="purchase-settlement-page"><header><p className="eyebrow">CCM Fishery</p><h1>{fishHead?'鱼头结单':'鱼仔结单'}</h1><Link className="page-link" to={fishHead?'/fish-head-purchase':'/fish-meal-purchase'}>← 返回现场录入</Link></header>
    <section className="settlement-context"><label>船号<select aria-label="船号" value={vesselId} disabled={Boolean(sessionId)||busy} onChange={event=>setVesselId(event.target.value)}>{vessels.map(item=><option value={item.id} key={item.id}>{item.vesselCode}</option>)}{sourceSession&&!selectedVessel&&<option value={sourceSession.vesselId}>{sourceSession.vesselCodeSnapshot}</option>}</select></label>
      <label>日期<input aria-label="日期" type="date" value={dateInputValue(businessDate)} disabled={Boolean(sessionId)||busy} onChange={event=>{if(event.target.value)setBusinessDate(event.target.value.split('-').reverse().join('/'))}}/><small>{businessDate}</small></label>
      <label className="settlement-receipt-no">单号（可之后补填）<input aria-label="单号" value={receiptNo} disabled={!editable||busy} onChange={event=>setReceiptNo(event.target.value)} placeholder="可留空"/></label></section>
    {error&&<p className="error" role="alert">{error}</p>}{message&&<p className="notice" role="status">{message}</p>}
    {loading?<p className="notice">正在载入结单资料…</p>:<section className="settlement-table-section"><p className="settlement-meta">船号：{sourceSession?.vesselCodeSnapshot??selectedVessel?.vesselCode??'—'} / 日期：{businessDate} / 当前记录：{sourceEntryCount} 条</p>
      {ready&&sourceSession&&<p className="notice">{editable?'首次完成称重后 7 天内可修改；重开不会延长期限。':'本单已锁定或超过 7 天修改期，只能查看。'}</p>}
      {ready&&sourceSession?.status==='completed'&&editable&&<Link className="page-link" to={`/weighing/${sourceSession.id}/review`}>修改称重（7 天内）</Link>}
      {lines.length===0?<p className="notice">当前没有称重资料，不能结单。</p>:<><div className="settlement-table-scroll"><table className="settlement-table"><caption>{fishHead?'鱼头结单检查表':'鱼仔结单检查表'}</caption><thead><tr><th>{fishHead?'鱼名':'品质'}</th><th>总重量</th><th>{fishHead?'篮数':'篮数/总重记录'}</th><th>预设价</th><th>单价 RM/kg</th><th>金额</th></tr></thead><tbody>{lines.map(line=><tr key={lineKey(line)}><th scope="row">{line.nameSnapshot}</th><td>{formatWeightKg(line.totalWeightGrams)} kg</td><td>{fishHead?`${line.basketCount}篮`:mealCountText(line)}</td><td>{priceText(line.defaultUnitPriceCentsPerKg)?`RM ${priceText(line.defaultUnitPriceCentsPerKg)}`:'-'}</td><td><input aria-label={`${line.nameSnapshot}单价`} type="text" inputMode="decimal" disabled={!editable||busy} value={priceInputs[lineKey(line)]??''} onChange={event=>changePrice(line,event.target.value)}/></td><td>{formatSettlementMoney(line.amountCents)}</td></tr>)}</tbody><tfoot><tr><th colSpan={5}>总额</th><td>{formatSettlementMoney(total)}</td></tr></tfoot></table></div><div className="settlement-actions"><button type="button" onClick={()=>void copyTable()}>复制表格</button><button className="primary-action" type="button" disabled={busy||!editable} onClick={()=>void saveDraft()}>保存结单草稿</button></div></>}
    </section>}
  </main>
}
