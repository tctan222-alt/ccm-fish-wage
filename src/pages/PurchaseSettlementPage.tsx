import { useEffect,useMemo,useRef,useState } from 'react'
import { useUnsavedChanges } from '../components/dirtyState'
import { Link,useParams,useSearchParams } from 'react-router-dom'
import { auth } from '../firebase'
import { businessDateFromLegacy,formatAuditTimestamp,legacyIsoDateFromBusinessDate,malaysiaBusinessDate,monthKeyFromBusinessDate,monthSortKeyFromMonthKey,sortKeyFromBusinessDate } from '../lib/businessDate'
import { assertFishHeadSettlementPrices,buildPurchaseSettlementLines,formatSettlementMoney,makeSettlementDraft,reconcileSettlementLines,settlementLineIdentity,updateSettlementLinePrice,totalSettlementAmountCents,type PurchaseSettlementDraft,type PurchaseSettlementLine,asSettlementSourceEntry } from '../lib/purchaseSettlement'
import { canModifyWeighing,formatWeightKg,type FishSpeciesRecord,type WeighingEntry,type WeighingProductType,type WeighingSession } from '../lib/weighing'
import type { Vessel } from '../lib/purchasing'
import { loadVessels } from '../services/purchaseMasterData'
import { finalizePurchaseSettlement,loadPurchaseSettlementDraft,loadPurchaseSettlementDraftForSource,loadPurchaseSettlementSource,savePurchaseSettlementDraft,type PurchaseSettlementSource } from '../services/purchaseSettlements'
import { loadFishSpecies,loadStableWeighingBundle,type WeighingBundle } from '../services/weighing'
import { readSettlementWithDeadline,settlementReadLabels,type SettlementReadStage } from '../lib/settlementRead'
import { canEditSettlement,settlementEditDeadline,settlementFinalizedTime } from '../lib/settlementLifecycle'
import { createSettlementLocalDraftStore,localDraftMatches,type SettlementLocalDraft,type SettlementLocalDraftStore } from '../services/settlementLocalDrafts'

function lineKey(line:PurchaseSettlementLine){return line.sourceEntryIds.join('|')}
function priceText(value:number|null){return value===null?'':(value/100).toFixed(2)}
function SettlementDefaultPrice({line,fishHead}:{line:PurchaseSettlementLine;fishHead:boolean}){
  if(line.defaultUnitPriceCentsPerKg===null)return fishHead?<><span>未设默认价</span><Link to={`/fish-species${line.fishSpeciesId?'#species-'+encodeURIComponent(line.fishSpeciesId):''}`}>编辑 Master 默认价</Link></>:'-'
  return <><span>RM {priceText(line.defaultUnitPriceCentsPerKg)}</span>{fishHead&&(line.baseUnitPriceCentsPerKg!==undefined&&line.vesselPremiumCentsPerKg!==undefined?<small>基础价 RM {priceText(line.baseUnitPriceCentsPerKg)} · 船号加价 RM {priceText(line.vesselPremiumCentsPerKg)}（默认快照）</small>:<small>已保存的默认价快照</small>)}</>
}
function dateInputValue(value:string){try{return legacyIsoDateFromBusinessDate(value)}catch{return ''}}
const systemNow=()=>new Date()
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
  draftLoader=loadPurchaseSettlementDraftForSource,
  legacyDraftLoader=loadPurchaseSettlementDraft,
  draftSaver=savePurchaseSettlementDraft,
  finalizer=finalizePurchaseSettlement,
  localDraftStore,
  bundleLoader=loadStableWeighingBundle,
  fishSpeciesLoader=loadFishSpecies,
  today=malaysiaBusinessDate,
  now=systemNow,
}: {
  productType:WeighingProductType
  vesselLoader?:()=>Promise<Vessel[]>
  sourceLoader?:(vesselId:string,businessDate:string,productType:WeighingProductType)=>Promise<PurchaseSettlementSource>
  draftLoader?:(source:WeighingBundle,productType:WeighingProductType,onLegacyRead?:()=>void)=>Promise<PurchaseSettlementDraft|null>
  legacyDraftLoader?:(productType:WeighingProductType,dateSortKey:number,vesselId:string)=>Promise<PurchaseSettlementDraft|null>
  draftSaver?:(draft:PurchaseSettlementDraft)=>Promise<PurchaseSettlementDraft>
  finalizer?:(draft:PurchaseSettlementDraft)=>Promise<PurchaseSettlementDraft>
  localDraftStore?:SettlementLocalDraftStore
  bundleLoader?:(sessionId:string)=>Promise<WeighingBundle>
  fishSpeciesLoader?:()=>Promise<FishSpeciesRecord[]>
  today?:()=>string
  now?:()=>Date
}){
  const {sessionId}=useParams()
  const [urlParams]=useSearchParams()
  const fishHead=productType==='fish_head'
  const [vessels,setVessels]=useState<Vessel[]>([]),[vesselId,setVesselId]=useState(''),[businessDate,setBusinessDate]=useState(today())
  const [entries,setEntries]=useState<WeighingEntry[]>([]),[lines,setLines]=useState<PurchaseSettlementLine[]>([])
  const [receiptNo,setReceiptNo]=useState(''),[priceInputs,setPriceInputs]=useState<Record<string,string>>({}),[error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false)
  const [loading,setLoading]=useState(true)
  const [readStage,setReadStage]=useState<SettlementReadStage>('source')
  const [vesselLoading,setVesselLoading]=useState(true)
  const [masterSpecies,setMasterSpecies]=useState<FishSpeciesRecord[]>([])
  const [editMasterLoading,setEditMasterLoading]=useState(false),[editMasterError,setEditMasterError]=useState('')
  const editMasterController=useRef<AbortController|null>(null)
  const [vesselError,setVesselError]=useState(''),[vesselAttempt,setVesselAttempt]=useState(0)
  const [readError,setReadError]=useState(''),[saveError,setSaveError]=useState(''),[localError,setLocalError]=useState('')
  const [loadFailed,setLoadFailed]=useState(false),[loadAttempt,setLoadAttempt]=useState(0)
  const [sourceSession,setSourceSession]=useState<WeighingSession|null>(null)
  const [loadedKey,setLoadedKey]=useState(''),[draftRevision,setDraftRevision]=useState(0)
  const [draftId,setDraftId]=useState<string|undefined>()
  const saveLock=useRef(false)
  const contextGeneration=useRef(0)
  const copyRequest=useRef(0)
  const [copyError,setCopyError]=useState(''),[manualCopy,setManualCopy]=useState<string|null>(null)
  const [savedFields,setSavedFields]=useState('')
  const [savedDraft,setSavedDraft]=useState<PurchaseSettlementDraft|null>(null),[editing,setEditing]=useState(false)
  const [recovery,setRecovery]=useState<SettlementLocalDraft|null>(null)
  const [localDraftBlocked,setLocalDraftBlocked]=useState(false)
  const localDraftTracked=useRef(false)
  const store=useMemo(()=>localDraftStore??createSettlementLocalDraftStore(auth.currentUser?.uid??'signed-out'),[localDraftStore])
  const requestedVesselId=sessionId?'':vesselId,requestedDate=sessionId?'':businessDate
  const contextKey=sessionId?`${productType}:${sessionId}`:`${productType}:${vesselId}:${businessDate}`
  const ready=!loading&&loadedKey===contextKey
  const [displayNow,setDisplayNow]=useState(()=>now())
  useEffect(()=>{const timer=window.setInterval(()=>setDisplayNow(now()),1000);return()=>window.clearInterval(timer)},[now])
  const dirty=ready&&JSON.stringify({receiptNo,priceInputs,lines})!==savedFields
  useUnsavedChanges(dirty)
  const lifecycle=savedDraft??{status:'settlement_draft' as const}
  const sourceCompatible=!savedDraft||savedDraft.status!=='settlement_finalized'||Boolean(sourceSession&&savedDraft.vesselId===sourceSession.vesselId&&savedDraft.businessDate===businessDateFromLegacy(sourceSession.weighingDate)&&savedDraft.vesselCodeSnapshot===sourceSession.vesselCodeSnapshot)
  const editable=ready&&Boolean(sourceSession&&['weighing','completed'].includes(sourceSession.status))&&canEditSettlement(lifecycle,displayNow)&&sourceCompatible
  const formEditable=editable&&!recovery&&!localDraftBlocked&&(lifecycle.status==='settlement_draft'||editing)
  const identity=sourceSession?{productType,sourceSessionId:sourceSession.id,sourceSessionRevision:sourceSession.revision,settlementRevision:draftRevision,businessDate,vesselId:sourceSession.vesselId,vesselCodeSnapshot:sourceSession.vesselCodeSnapshot}:null
  const recoveryStale=Boolean(recovery&&identity&&!localDraftMatches(recovery,identity))
  const finalizedTime=settlementFinalizedTime(lifecycle),deadline=settlementEditDeadline(lifecycle)
  const returnPath=productType==='fish_head'?'/fish-head-settlement':'/fish-meal-settlement'
  const requestedReturn=urlParams.get('return')
  const listPath=requestedReturn&&(requestedReturn===returnPath||requestedReturn.startsWith(returnPath+'?'))?requestedReturn:returnPath

  useEffect(()=>{
    if((!dirty&&!localDraftTracked.current)||!ready||!sourceSession||recovery||localDraftBlocked)return
    try{
      store.save({version:1,productType,sourceSessionId:sourceSession.id,sourceSessionRevision:sourceSession.revision,settlementRevision:draftRevision,businessDate,
        vesselId:sourceSession.vesselId,vesselCodeSnapshot:sourceSession.vesselCodeSnapshot,receiptNo,priceInputs,lines,updatedAt:new Date().toISOString()})
      localDraftTracked.current=true;setLocalError('')
    }catch(problem){setLocalError(problem instanceof Error?problem.message:'无法保存本机草稿。')}
  },[dirty,ready,sourceSession,recovery,localDraftBlocked,store,productType,draftRevision,businessDate,receiptNo,priceInputs,lines])

  useEffect(()=>{
    const controller=new AbortController()
    setVesselError('');setVesselLoading(true)
    void readSettlementWithDeadline(vesselLoader,controller.signal,()=> 'vessels').then(items=>{
      if(controller.signal.aborted)return
      setVessels(items);if(!sessionId)setVesselId(current=>current||items.find(item=>item.active)?.id||'')
    }).catch(problem=>{if(!controller.signal.aborted)setVesselError(`${problem instanceof Error?problem.message:'无法载入船号资料。'} 仍可查看指定的历史结单。`)}).finally(()=>{if(!controller.signal.aborted)setVesselLoading(false)})
    return()=>controller.abort()
  },[vesselLoader,sessionId,vesselAttempt])

  useEffect(()=>{
    if(!sessionId&&!requestedVesselId){setLoading(false);return}
    let cancelled=false
    let finished=false,stage:SettlementReadStage='source'
    const controller=new AbortController()
    const progress=(next:SettlementReadStage)=>{if(!cancelled&&!finished){stage=next;setReadStage(next)}}
    const read=<T,>(operation:()=>Promise<T>)=>readSettlementWithDeadline(operation,controller.signal,()=>stage)
    contextGeneration.current+=1;saveLock.current=false;setBusy(false)
    editMasterController.current?.abort();setEditMasterLoading(false);setEditMasterError('')
    copyRequest.current+=1;setCopyError('');setManualCopy(null)
    setLoading(true);setLoadFailed(false);setReadError('');setLoadedKey('');setLines([]);setEntries([]);setSourceSession(null);setDraftId(undefined);setError('');setSaveError('');setMessage('');setRecovery(null);setEditing(false)
    localDraftTracked.current=false;setLocalDraftBlocked(false)
    progress('source')
    void (async()=>{
      const source=await read(async()=>sessionId?bundleLoader(sessionId):(await sourceLoader(requestedVesselId,requestedDate,productType)).bundle)
      if(cancelled)return
      if(sessionId&&source?.session.id!==sessionId)throw new Error('来源现场单与当前路径不一致，请重新载入。')
      if(source?.session.productType&&source.session.productType!==productType)throw new Error('结单类型与来源称重单不一致。')
      const date=source?businessDateFromLegacy(source.session.weighingDate):requestedDate
      const sourceVesselId=source?.session.vesselId??requestedVesselId
      if(!sessionId&&source&&(date!==requestedDate||sourceVesselId!==requestedVesselId))throw new Error('称重资料日期或船号已变更，请重新选择或从结单列表打开。')
      progress(source?'settlement':'legacy')
      const draft=await read(()=>source?draftLoader(source,productType,()=>progress('legacy')):legacyDraftLoader(productType,sortKeyFromBusinessDate(date),sourceVesselId))
      if(cancelled)return
      if(draft?.sourceSessionId&&source&&draft.sourceSessionId!==source.session.id)throw new Error('结单关联了另一张称重单，请核查来源。')
      const sourceEntries=source?.entries??[]
      let species:FishSpeciesRecord[]=[]
      if(fishHead&&sourceEntries.length&&draft?.status!=='settlement_finalized'){progress('master');species=await read(fishSpeciesLoader);if(cancelled)return}
      setMasterSpecies(species)
      let nextLines:PurchaseSettlementLine[]
      if(draft?.status==='settlement_finalized')nextLines=draft.lines
      else{
        const built=buildPurchaseSettlementLines(sourceEntries.map(asSettlementSourceEntry),productType,source?.session.vesselCodeSnapshot??'',species)
        nextLines=source?(draft?reconcileSettlementLines(built,draft.lines):built):(draft?.lines??[])
      }
      setSavedDraft(draft)
      setSourceSession(source?.session??null);setEntries(sourceEntries);setReceiptNo(draft?.receiptNo??source?.session.externalSlipNo??'');setDraftRevision(draft?.revision??0)
      setDraftId(draft?.draftId)
      const nextPrices=Object.fromEntries(nextLines.map(line=>[lineKey(line),priceText(line.unitPriceCentsPerKg)]))
      setLines(nextLines);setPriceInputs(nextPrices)
      setSavedFields(JSON.stringify({receiptNo:draft?.receiptNo??source?.session.externalSlipNo??'',priceInputs:nextPrices,lines:nextLines}))
      if(sessionId){setVesselId(draft?.status==='settlement_finalized'?draft.vesselId:sourceVesselId);setBusinessDate(draft?.status==='settlement_finalized'?draft.businessDate:date)}
      if(source){progress('local');try{const found=store.load(productType,source.session.id);localDraftTracked.current=Boolean(found);setRecovery(found);setLocalError('')}catch(problem){setLocalDraftBlocked(true);setLocalError(problem instanceof Error?problem.message:'无法读取本机草稿。')}}
      setLoadedKey(contextKey)
    })().catch(problem=>{if(!cancelled){setLoadFailed(true);setReadError(problem instanceof Error?problem.message:'无法载入结单资料。')}}).finally(()=>{finished=true;if(!cancelled)setLoading(false)})
    return()=>{cancelled=true;controller.abort();editMasterController.current?.abort();contextGeneration.current+=1}
  },[requestedVesselId,requestedDate,productType,sourceLoader,draftLoader,legacyDraftLoader,bundleLoader,fishSpeciesLoader,fishHead,sessionId,contextKey,loadAttempt,store])

  const selectedVessel=vessels.find(item=>item.id===vesselId)
  const waitingForVessel=!sessionId&&!vesselId&&vesselLoading
  const total=useMemo(()=>totalSettlementAmountCents(lines),[lines])
  const sourceEntryCount=entries.filter(item=>!item.voided&&item.productType===productType).length
  function changePrice(line:PurchaseSettlementLine,value:string){
    const key=lineKey(line);setPriceInputs(current=>({...current,[key]:value}));
    try{const updated=updateSettlementLinePrice(line,value);setLines(current=>current.map(item=>lineKey(item)===key?updated:item));setError('')}
    catch(problem){setError(problem instanceof Error?problem.message:'单价格式不正确。')}
  }
  async function saveDraft(finalize=false){
    if(saveLock.current)return
    if(!formEditable||!canEditSettlement(lifecycle,now())||!sourceSession||lines.length===0){setError('当前结单只读，不能保存修改。');return}
    let validatedLines:PurchaseSettlementLine[]
    try{validatedLines=lines.map(line=>({...updateSettlementLinePrice(line,priceInputs[lineKey(line)]??''),priceWasEdited:line.priceWasEdited}));if(finalize||lifecycle.status==='settlement_finalized')assertFishHeadSettlementPrices({productType,lines:validatedLines});setError('')}
    catch(problem){setError(problem instanceof Error?problem.message:'单价格式不正确。');return}
    let submittedLocalDraft:SettlementLocalDraft|null
    try{
      const cached=store.load(productType,sourceSession.id)
      submittedLocalDraft=cached&&identity&&localDraftMatches(cached,identity)&&cached.receiptNo===receiptNo
        &&JSON.stringify(cached.priceInputs)===JSON.stringify(priceInputs)&&JSON.stringify(cached.lines)===JSON.stringify(lines)?cached:null
    }catch(problem){setLocalDraftBlocked(true);setLocalError(problem instanceof Error?problem.message:'无法读取本机草稿。');return}
    const submittedGeneration=contextGeneration.current
    try{
      saveLock.current=true;setBusy(true);setSaveError('');setMessage('')
      const monthKey=monthKeyFromBusinessDate(businessDate)
      const saved=await (finalize?finalizer:draftSaver)({...makeSettlementDraft({productType,businessDate,dateSortKey:sortKeyFromBusinessDate(businessDate),monthKey,monthSortKey:monthSortKeyFromMonthKey(monthKey),
        vesselId:sourceSession.vesselId,vesselCodeSnapshot:sourceSession.vesselCodeSnapshot,receiptNo:receiptNo.trim(),lines:validatedLines,sourceEntryIds:entries.filter(item=>!item.voided&&item.productType===productType).map(item=>item.id),revision:draftRevision}),
        status:lifecycle.status,...(draftId?{draftId}:{}),sourceSessionId:sourceSession.id,sourceSessionRevision:sourceSession.revision})
      if(contextGeneration.current!==submittedGeneration){
        // The confirmed write belongs to the abandoned source, not the currently displayed invoice.
        try{store.removeIfUnchanged(productType,sourceSession.id,submittedLocalDraft)}catch{/* Preserve its cache for review when that source is reopened. */}
        return
      }
      setDraftRevision(saved.revision);setDraftId(saved.draftId)
      localDraftTracked.current=false
      setLines(validatedLines);setSavedFields(JSON.stringify({receiptNo,priceInputs,lines:validatedLines}))
      setSavedDraft(saved);setEditing(false)
      try{const cleared=store.removeIfUnchanged(productType,sourceSession.id,submittedLocalDraft);setRecovery(null);setLocalDraftBlocked(!cleared);setLocalError(cleared?'':'服务器已保存；另一个页面的较新本机草稿已保留，请重试本机草稿后核对。')}catch(problem){setLocalDraftBlocked(true);setLocalError(problem instanceof Error?problem.message:'无法清除本机草稿。')}
      setMessage(`${finalize?'已完成结单':saved.status==='settlement_finalized'?'结单修改已保存':'结单草稿已保存'}（第 ${saved.revision} 版）。`)
    }catch(problem){if(contextGeneration.current===submittedGeneration)setSaveError(problem instanceof Error?problem.message:'无法保存结单，本机草稿已保留。')}finally{if(contextGeneration.current===submittedGeneration){setBusy(false);saveLock.current=false}}
  }
  function restoreDraft(){
    if(!recovery||recoveryStale||!editable)return
    setReceiptNo(recovery.receiptNo);setPriceInputs(recovery.priceInputs);setLines(recovery.lines);setEditing(true);setRecovery(null)
  }
  function discardDraft(){
    if(!sourceSession)return
    try{store.remove(productType,sourceSession.id);localDraftTracked.current=false;setRecovery(null);setLocalDraftBlocked(false);setLocalError('')}catch(problem){setLocalError(problem instanceof Error?problem.message:'无法清除本机草稿。')}
  }
  function retryLocalDraft(){
    if(!sourceSession)return
    try{const found=store.load(productType,sourceSession.id);localDraftTracked.current=Boolean(found);setRecovery(found);setLocalDraftBlocked(false);setLocalError('')}catch(problem){setLocalError(problem instanceof Error?problem.message:'无法读取本机草稿。')}
  }
  function discardCurrentDraft(){
    if(!sourceSession)return
    try{
      store.remove(productType,sourceSession.id)
      localDraftTracked.current=false
      const baseline=JSON.parse(savedFields) as {receiptNo:string;priceInputs:Record<string,string>;lines:PurchaseSettlementLine[]}
      setReceiptNo(baseline.receiptNo);setPriceInputs(baseline.priceInputs);setLines(baseline.lines);setEditing(false)
      setError('');setSaveError('');setLocalError('')
    }catch(problem){setLocalError(problem instanceof Error?problem.message:'无法放弃本机草稿。')}
  }
  function changeContext(change:()=>void){
    if(dirty){setError('本机草稿已保留；请先保存当前结单，或明确放弃草稿后切换日期／船号。');return}
    change()
  }
  async function beginEdit(){
    if(!editable||recovery||localDraftBlocked||busy)return
    setError('');setEditMasterError('')
    try{
      // A source weight correction is reviewed explicitly, never changes finalized view on read.
      let current=buildPurchaseSettlementLines(entries.map(asSettlementSourceEntry),productType,sourceSession?.vesselCodeSnapshot??'',masterSpecies)
      const needsNewDefaults=fishHead&&current.some(line=>!lines.some(saved=>settlementLineIdentity(saved)===settlementLineIdentity(line)))
      if(needsNewDefaults){
        const generation=contextGeneration.current,controller=new AbortController()
        editMasterController.current=controller;setBusy(true);setEditMasterLoading(true)
        let species:FishSpeciesRecord[]
        try{
          species=await readSettlementWithDeadline(fishSpeciesLoader,controller.signal,()=> 'master')
          if(controller.signal.aborted||generation!==contextGeneration.current)return
          setMasterSpecies(species)
        }catch(problem){if(generation===contextGeneration.current&&!controller.signal.aborted)setEditMasterError(`无法读取新增鱼种的默认价：${problem instanceof Error?problem.message:'请重试。'} 已保存结单仍可查看。`);return}
        finally{if(generation===contextGeneration.current){setBusy(false);setEditMasterLoading(false)}}
        current=buildPurchaseSettlementLines(entries.map(asSettlementSourceEntry),productType,sourceSession?.vesselCodeSnapshot??'',species)
      }
      const next=reconcileSettlementLines(current,lines)
      setLines(next);setPriceInputs(Object.fromEntries(next.map(line=>[lineKey(line),priceText(line.unitPriceCentsPerKg)])));setEditing(true)
    }catch{setError('无法更新结单重量，请核对来源称重资料的重量与价格范围；已保存结单仍可查看。')}
  }
  async function copyTable(){
    const header=fishHead?'鱼名\t总重量\t篮数\t预设价\t单价 RM/kg\t金额':'品质\t总重量\t篮数/总重记录\t预设价\t单价 RM/kg\t金额'
    const rows=lines.map(line=>[line.nameSnapshot,`${formatWeightKg(line.totalWeightGrams)} kg`,fishHead?`${line.basketCount}篮`:mealCountText(line),priceText(line.defaultUnitPriceCentsPerKg)||'-',priceText(line.unitPriceCentsPerKg),formatSettlementMoney(line.amountCents)].join('\t'))
    const text=[header,...rows,`总额\t${formatSettlementMoney(total)}`].join('\n'),request=++copyRequest.current
    setMessage('');setCopyError('');setManualCopy(null)
    if(typeof navigator.clipboard?.writeText!=='function'){
      setCopyError('浏览器不支持自动复制，请长按下方文字手动复制。');setManualCopy(text);return
    }
    try{await navigator.clipboard.writeText(text);if(request===copyRequest.current)setMessage('表格已复制，可以贴到 Excel。')}
    catch{if(request===copyRequest.current){setCopyError('无法自动复制表格，请长按下方文字手动复制。');setManualCopy(text)}}
  }
  return <main className="purchase-settlement-page"><header><p className="eyebrow">CCM Fishery</p><h1>{fishHead?'鱼头结单':'鱼仔结单'}</h1><Link className="page-link" to={listPath}>← 返回结单列表</Link> <Link className="page-link" to={fishHead?'/fish-head-purchase':'/fish-meal-purchase'}>现场录入</Link></header>
    <section className="settlement-context"><label>船号<select aria-label="船号" value={vesselId} disabled={Boolean(sessionId)||busy||Boolean(recovery)||lifecycle.status==='settlement_finalized'} onChange={event=>changeContext(()=>setVesselId(event.target.value))}>{vessels.map(item=><option value={item.id} key={item.id}>{item.vesselCode}</option>)}{sourceSession&&!selectedVessel&&<option value={sourceSession.vesselId}>{sourceSession.vesselCodeSnapshot}</option>}</select></label>
      <label>日期<input aria-label="日期" type="date" value={dateInputValue(businessDate)} disabled={Boolean(sessionId)||busy||Boolean(recovery)||lifecycle.status==='settlement_finalized'} onChange={event=>{const value=event.target.value;if(value)changeContext(()=>setBusinessDate(value.split('-').reverse().join('/')))}}/><small>{businessDate}</small></label>
      <label className="settlement-receipt-no">{fishHead?'鱼头纸单号':'鱼仔纸单号'}（可之后补填）<input aria-label={fishHead?'鱼头纸单号':'鱼仔纸单号'} value={receiptNo} disabled={!formEditable||busy} onChange={event=>setReceiptNo(event.target.value)} placeholder="可留空"/></label></section>
    {vesselError&&<div><p className="error" role="alert">{vesselError}</p><button type="button" onClick={()=>setVesselAttempt(current=>current+1)}>重试船号</button></div>}
    {readError&&<p className="error" role="alert">{readError}</p>}{loadFailed&&!loading&&<button type="button" disabled={busy} onClick={()=>setLoadAttempt(current=>current+1)}>重新载入结单</button>}
    {editMasterLoading&&<p className="notice" role="status">正在读取新增鱼种默认价…</p>}{editMasterError&&<p className="error" role="alert">{editMasterError}</p>}
    {error&&<p className="error" role="alert">{error}</p>}{saveError&&<p className="error" role="alert">{saveError} 本机草稿已保留；如保存结果不明，请重新打开后核对服务器版本。</p>}{localError&&<p className="error" role="alert">{localError}</p>}
    {ready&&localDraftBlocked&&<div><p>本机草稿未能安全读取，暂时禁止编辑，避免覆盖未保存内容。</p><button type="button" onClick={retryLocalDraft}>重试本机草稿</button> <button type="button" onClick={discardDraft}>放弃无法读取的本机草稿</button></div>}
    {message&&<p className="notice" role="status">{message}</p>}
    {ready&&recovery&&<section className="notice" aria-label="本机草稿恢复"><h2>发现未完成草稿</h2>
      <p>本机更新时间：{recovery.updatedAt}。尚未保存到服务器。</p>
      {recoveryStale&&<p role="alert">服务器资料已更新，本机草稿需要重新核对。</p>}
      <p>本机纸单号：{recovery.receiptNo||'—'} / 服务器纸单号：{receiptNo||'—'}</p>
      <div className="settlement-table-scroll"><table><caption>本机与服务器核对</caption><thead><tr><th>鱼名／品质</th><th>本机重量 kg</th><th>本机单价</th><th>服务器重量 kg</th><th>服务器单价</th></tr></thead><tbody>{recovery.lines.map(line=>{const current=lines.find(item=>item.nameSnapshot===line.nameSnapshot);return <tr key={lineKey(line)}><th>{line.nameSnapshot}</th><td>{formatWeightKg(line.totalWeightGrams)}</td><td>{recovery.priceInputs[lineKey(line)]??'—'}</td><td>{current?formatWeightKg(current.totalWeightGrams):'—'}</td><td>{current?priceInputs[lineKey(current)]:'—'}</td></tr>})}</tbody></table></div>
      <p>{recoveryStale?'请记录并核对本机内容，放弃旧草稿后在最新资料上逐项重新输入；不会自动覆盖服务器。':'恢复只带回本机输入，不会写入服务器。'}</p>
      <button type="button" disabled={recoveryStale||!editable} onClick={restoreDraft}>恢复草稿</button> <button type="button" onClick={discardDraft}>放弃草稿</button>
    </section>}
    {loading||waitingForVessel?<p className="notice" role="status">正在载入结单资料…<br/>{settlementReadLabels[waitingForVessel?'vessels':readStage]}…</p>:loadFailed?null:<section className="settlement-table-section"><p className="settlement-meta">船号：{savedDraft?.status==='settlement_finalized'?savedDraft.vesselCodeSnapshot:sourceSession?.vesselCodeSnapshot??selectedVessel?.vesselCode??'—'} / 日期：{businessDate} / 当前记录：{sourceEntryCount} 条</p>
      {sourceSession&&<p>系统现场单号：{sourceSession.sessionCode}</p>}
      {lines.some(line=>line.unitPriceCentsPerKg===null)&&<p className="notice">尚有未定价项目：{lines.filter(line=>line.unitPriceCentsPerKg===null).map(line=>line.nameSnapshot).join('、')}。{fishHead?'请填写本单实际价；未定价金额不计入暂计总额，填完后才能完成结单。':'未定价行不猜价，金额按既有规则显示为 0；完成前请核对。'}</p>}
      {ready&&sourceSession&&<p className="notice">{sourceSession.status==='processed'?'来源已转旧版采购单 Legacy processed，本页只读。':sourceSession.status==='voided'?'来源已作废，本页只读。':lifecycle.status==='settlement_draft'?'结单草稿 Draft；完成结单后 90 天内可修改。':editable?'已完成结单 Finalized；修改不会延长期限。':'已锁定 Locked；超过 90 天或来源不兼容，只能查看。'}</p>}
      {finalizedTime&&deadline&&<p>首次完成：{formatAuditTimestamp(finalizedTime)} / 修改截止：{formatAuditTimestamp(deadline)}（到达截止时刻即只读）</p>}
      {savedDraft?.status==='settlement_finalized'&&sourceSession&&savedDraft.sourceSessionRevision!==sourceSession.revision&&<p className="notice">称重来源版本已更新，请进入修改后核对重量；当前展示已保存的正式结单。</p>}
      {ready&&sourceSession?.status==='completed'&&canModifyWeighing(sourceSession,now())&&<Link className="page-link" to={`/weighing/${sourceSession.id}/review`}>修改称重（7 天内）</Link>}
      {!sourceSession&&<p className="notice">找不到 {(selectedVessel?.vesselCode??vesselId)||'所选船号'} / {businessDate} 的已完成称重单。</p>}
      {lines.length===0?<p className="notice">当前没有称重资料，不能结单。</p>:<><div className="settlement-table-scroll"><table className={`settlement-table${fishHead?' settlement-table-fish-head':''}`}><caption>{fishHead?'鱼头结单检查表':'鱼仔结单检查表'}</caption><thead><tr><th>{fishHead?'鱼名':'品质'}</th><th>总重量</th><th>{fishHead?'篮数':'篮数/总重记录'}</th><th>预设价</th><th>{fishHead?'本单实际 RM/kg':'单价 RM/kg'}</th><th>金额</th></tr></thead><tbody>{lines.map(line=><tr key={lineKey(line)}><th scope="row">{line.nameSnapshot}</th><td data-label="总重量">{formatWeightKg(line.totalWeightGrams)} kg</td><td data-label={fishHead?'篮数':'篮数/总重记录'}>{fishHead?`${line.basketCount}篮`:mealCountText(line)}</td><td data-label="默认建议价" className="settlement-default-price"><SettlementDefaultPrice line={line} fishHead={fishHead}/></td><td data-label={fishHead?'本单实际 RM/kg':'单价 RM/kg'}><input aria-label={`${line.nameSnapshot}单价`} type="text" inputMode="decimal" disabled={!formEditable||busy} value={priceInputs[lineKey(line)]??''} onChange={event=>changePrice(line,event.target.value)}/></td><td data-label="金额">{fishHead&&line.unitPriceCentsPerKg===null?'未定价':formatSettlementMoney(line.amountCents)}</td></tr>)}</tbody><tfoot><tr><th colSpan={5}>{fishHead&&lines.some(line=>line.unitPriceCentsPerKg===null)?'暂计总额':'总额'}</th><td>{formatSettlementMoney(total)}</td></tr></tfoot></table></div>{fishHead&&<p className="settlement-price-help">本单实际价仅用于这张结单，不会修改 Master 基础默认价。</p>}<div className="settlement-actions"><button type="button" onClick={()=>void copyTable()}>复制表格</button>
        {lifecycle.status==='settlement_finalized'&&!editing?<button type="button" disabled={!editable||Boolean(recovery)||localDraftBlocked||busy} onClick={()=>void beginEdit()}>{editMasterError?'重新读取默认价并修改':'修改结单 Edit'}</button>:<button className="primary-action" type="button" disabled={busy||!formEditable} onClick={()=>void saveDraft()}>{lifecycle.status==='settlement_finalized'?'保存修改':'保存结单草稿'}</button>}
        {lifecycle.status==='settlement_draft'&&<button type="button" disabled={busy||!formEditable||sourceSession?.status!=='completed'} onClick={()=>void saveDraft(true)}>{busy?'保存中…':'完成结单 Finalize'}</button>}
        {dirty&&!recovery&&<button type="button" disabled={busy} onClick={discardCurrentDraft}>放弃当前未保存草稿</button>}
      </div></>}
      {copyError&&<p className="error" role="alert">{copyError}</p>}
      {manualCopy!==null&&<label className="settlement-manual-copy">手动复制表格<textarea aria-label="手动复制表格" readOnly rows={Math.min(12,lines.length+3)} value={manualCopy} onFocus={event=>event.currentTarget.select()}/></label>}
    </section>}
  </main>
}
