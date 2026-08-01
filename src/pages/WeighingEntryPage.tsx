import { useCallback,useEffect,useMemo,useRef,useState,type FormEvent } from 'react'
import { Link,useParams } from 'react-router-dom'
import { auth } from '../firebase'
import { DEFAULT_VESSELS,type Vessel } from '../lib/purchasing'
import { DecimalKeypad } from '../components/DecimalKeypad'
import { malaysiaBusinessDate } from '../lib/businessDate'
import {
  FISH_MEAL_QUALITIES,
  DEFAULT_FISH_SPECIES,
  activeFishSpecies,
  applyEntryCreated,
  applyEntryReplacement,
  buildWeighingEntry,
  formatMalaysiaDate,
  formatWeightKg,
  kgInputToGrams,
  newWeighingSession,
  weighingDraftKey,
  softVoidWeighingEntry,
  summarizeWeighingEntries,
  type FishMealQuality,
  type FishSpeciesRecord,
  type WeighingEntry,
  type WeighingEntryMode,
  type WeighingProductType,
  type WeighingSession,
} from '../lib/weighing'
import { initializeDefaultVessels,loadVessels } from '../services/purchaseMasterData'
import {
  createIndexedDbWeighingStore,
  flushWeighingQueue,
  type PendingWeighingOperation,
  type WeighingOfflineStore,
} from '../services/weighingOffline'
import {
  findOpenWeighingSession,
  findClosedWeighingSession,
  loadFishSpecies,
  initializeDefaultFishSpecies,
  loadWeighingBundle,
  saveFishSpecies,
  syncWeighingOperation,
  type WeighingBundle,
} from '../services/weighing'

const defaultStore=typeof indexedDB==='undefined'?undefined:createIndexedDbWeighingStore()
const malaysiaToday=()=>malaysiaBusinessDate()
const isoNow=()=>new Date().toISOString()
const makeId=(kind:'session'|'entry'|'operation')=>`${kind}-${globalThis.crypto?.randomUUID?.()??`${Date.now()}-${Math.random().toString(36).slice(2)}`}`
function parseCachedRows<T>(value:string|undefined):T[]|undefined{
  if(!value)return undefined
  try{const parsed:unknown=JSON.parse(value);return Array.isArray(parsed)?parsed as T[]:undefined}catch{return undefined}
}

interface Props {
  vesselLoader?:()=>Promise<Vessel[]>
  speciesLoader?:()=>Promise<FishSpeciesRecord[]>
  openSessionLoader?:(vesselId:string,date:string,productType:WeighingProductType)=>Promise<WeighingBundle|null>
  closedSessionLoader?:(vesselId:string,date:string,productType:WeighingProductType)=>Promise<WeighingBundle|null>
  bundleLoader?:(sessionId:string)=>Promise<WeighingBundle>
  offlineStore?:WeighingOfflineStore
  remoteSync?:(operation:PendingWeighingOperation)=>Promise<{session?:WeighingSession;entry?:WeighingEntry}>
  today?:()=>string
  now?:()=>string
  idFactory?:(kind:'session'|'entry'|'operation')=>string
  fixedProductType?:WeighingProductType
  pageTitle?:string
  speciesCreator?:(value:FishSpeciesRecord)=>Promise<FishSpeciesRecord>
  vesselInitializer?:()=>Promise<Vessel[]>
  speciesInitializer?:(items:FishSpeciesRecord[])=>Promise<FishSpeciesRecord[]>
}

function visibleVessels(items:Vessel[]){
  const byCode=new Map(items.map(item=>[item.vesselCode,item]))
  const defaults:Vessel[]=DEFAULT_VESSELS.map(item=>({...item}))
  const standard=defaults.flatMap(item=>{
    const saved=byCode.get(item.vesselCode)
    return saved?(saved.active?[saved]:[]):[item]
  }).filter(item=>item.active)
  const defaultCodes=new Set(defaults.map(item=>item.vesselCode))
  const custom=items.filter(item=>item.active&&!defaultCodes.has(item.vesselCode)).sort((a,b)=>(a.order??Number.MAX_SAFE_INTEGER)-(b.order??Number.MAX_SAFE_INTEGER)||a.vesselCode.localeCompare(b.vesselCode))
  return [...standard,...custom]
}

function visibleFishSpecies(items:FishSpeciesRecord[]){
  const byCode=new Map(items.map(item=>[item.speciesCode,item]))
  const defaults=DEFAULT_FISH_SPECIES.map(item=>byCode.get(item.speciesCode)??item)
  const custom=items.filter(item=>!DEFAULT_FISH_SPECIES.some(defaultItem=>defaultItem.speciesCode===item.speciesCode)&&item.active)
  return [...defaults,...custom]
}

export function WeighingEntryPage({
  vesselLoader=loadVessels,speciesLoader=loadFishSpecies,openSessionLoader=findOpenWeighingSession,
  closedSessionLoader=findClosedWeighingSession,
  bundleLoader=loadWeighingBundle,offlineStore=defaultStore,remoteSync=syncWeighingOperation,
  today=malaysiaToday,now=isoNow,idFactory=makeId,fixedProductType,pageTitle='现场称重',speciesCreator=saveFishSpecies,
  vesselInitializer=initializeDefaultVessels,speciesInitializer=initializeDefaultFishSpecies,
}:Props){
  const {sessionId}=useParams()
  const [vessels,setVessels]=useState<Vessel[]>(()=>visibleVessels(DEFAULT_VESSELS))
  const [species,setSpecies]=useState<FishSpeciesRecord[]>([])
  const [vesselId,setVesselId]=useState('')
  const [date,setDate]=useState(today())
  const [externalSlipNo,setExternalSlipNo]=useState('')
  const [session,setSession]=useState<WeighingSession|null>(null)
  const [entries,setEntries]=useState<WeighingEntry[]>([])
  const [productType,setProductType]=useState<WeighingProductType>(fixedProductType??'fish_head')
  const [speciesId,setSpeciesId]=useState('')
  const [quality,setQuality]=useState<FishMealQuality>('bucket')
  const [entryMode,setEntryMode]=useState<WeighingEntryMode>('individual')
  const [weight,setWeight]=useState('')
  const [remark,setRemark]=useState('')
  const [pending,setPending]=useState(0)
  const [busy,setBusy]=useState(false)
  const [message,setMessage]=useState('')
  const [error,setError]=useState('')
  const [referenceAttempt,setReferenceAttempt]=useState(0)
  const [showComplete,setShowComplete]=useState(false)
  const [editing,setEditing]=useState<WeighingEntry|null>(null)
  const [showCustomSpecies,setShowCustomSpecies]=useState(false)
  const [contextLoading,setContextLoading]=useState(false)
  const weightRef=useRef<HTMLInputElement>(null)
  const saveLock=useRef(false)
  const contextRequest=useRef(0)

  const store=offlineStore
  const activeSpecies=useMemo(()=>activeFishSpecies(species),[species])
  const displayedSpecies=useMemo(()=>visibleFishSpecies(species),[species])
  const activeEntries=entries.filter(item=>!item.voided)
  const summary=summarizeWeighingEntries(entries)
  const latestIndividual=activeEntries.find(item=>item.entryMode==='individual')
  const latest=activeEntries[0]
  const selectedVessel=vessels.find(item=>item.id===vesselId)
  const locked=Boolean(session&&session.status!=='weighing')

  useEffect(()=>{if(fixedProductType)setProductType(fixedProductType)},[fixedProductType])

  useEffect(()=>{
    let cancelled=false
    void (async()=>{
      const [vesselResult,speciesResult]=await Promise.allSettled([vesselLoader(),speciesLoader()])
      let vesselRows=vesselResult.status==='fulfilled'?vesselResult.value:undefined
      let speciesRows=speciesResult.status==='fulfilled'?speciesResult.value:undefined
      if(store){
        if(vesselRows)await store.putMeta('reference:vessels',JSON.stringify(vesselRows))
        else vesselRows=parseCachedRows<Vessel>(await store.getMeta('reference:vessels'))
        if(speciesRows)await store.putMeta('reference:species',JSON.stringify(speciesRows))
        else speciesRows=parseCachedRows<FishSpeciesRecord>(await store.getMeta('reference:species'))
      }
      if(cancelled)return
      const sourceVessels=vesselRows??[],sourceSpecies=speciesRows??[]
      const availableVessels=visibleVessels(sourceVessels)
      setVessels(availableVessels);setSpecies(sourceSpecies)
      setSpeciesId(visibleFishSpecies(sourceSpecies).find(item=>item.active)?.id??'')
      const preferred=store?await store.getMeta('lastVesselId'):undefined
      if(cancelled)return
      setVesselId(availableVessels.some(item=>item.id===preferred)?preferred!:availableVessels[0]?.id??'')
      if(vesselResult.status==='fulfilled'&&DEFAULT_VESSELS.some(item=>!sourceVessels.some(row=>row.vesselCode===item.vesselCode))){
        void vesselInitializer().then(next=>{if(!cancelled)setVessels(visibleVessels(next))}).catch(()=>undefined)
      }
      if(speciesResult.status==='fulfilled'&&DEFAULT_FISH_SPECIES.some(item=>!sourceSpecies.some(row=>row.speciesCode===item.speciesCode))){
        void speciesInitializer(sourceSpecies).then(next=>{if(!cancelled)setSpecies(next)}).catch(()=>undefined)
      }
      if(vesselResult.status==='rejected'||speciesResult.status==='rejected'){
        setError('无法载入船号或鱼名资料，正在显示本机默认资料。')
      }
    })()
    return()=>{cancelled=true}
  },[vesselLoader,speciesLoader,store,referenceAttempt,vesselInitializer,speciesInitializer])

  useEffect(()=>{
    if(sessionId){
      void bundleLoader(sessionId).then(async bundle=>{
        if(store){
          await store.putSession(bundle.session)
          for(const entry of bundle.entries)await store.putEntry(entry)
          await store.putMeta(weighingDraftKey(bundle.session.productType??'fish_head',bundle.session.weighingDate,bundle.session.vesselId),bundle.session.id)
        }
        setSession(bundle.session);setEntries(bundle.entries);setVesselId(bundle.session.vesselId)
        setDate(bundle.session.weighingDate);setExternalSlipNo(bundle.session.externalSlipNo)
        if(bundle.session.productType)setProductType(bundle.session.productType)
      }).catch(()=>setError('无法载入现场称重单。'))
    }
  },[sessionId,bundleLoader,store])

  useEffect(()=>{
    if(sessionId||!vesselId||!store){if(!sessionId)setContextLoading(false);return}
    let cancelled=false
    const request=++contextRequest.current
    const isCurrent=()=>!cancelled&&request===contextRequest.current
    void (async()=>{
      const key=weighingDraftKey(productType,date,vesselId)
      let local:WeighingSession|undefined,localEntries:WeighingEntry[]=[],pendingCount=0,localId:string|undefined
      try{
        setSession(null);setEntries([]);setPending(0);setExternalSlipNo('')
        localId=await store.getMeta(key)
        if(!isCurrent())return
        if(localId){
          local=await store.getSession(localId)
          if(!isCurrent())return
          if(local){
            localEntries=await store.getEntries(local.id)
            pendingCount=(await store.getPending()).filter(item=>item.sessionId===local!.id).length
            if(!isCurrent())return
            setSession(local);setEntries(localEntries);setExternalSlipNo(local.externalSlipNo);setPending(pendingCount)
          }
        }
        const open=localId?await bundleLoader(localId):await openSessionLoader(vesselId,date,productType)
        const remote=open??(!localId?await closedSessionLoader(vesselId,date,productType):null)
        if(!isCurrent())return
        if(remote){
          const serverLocked=remote.session.status!=='weighing'
          const useRemote=pendingCount===0||serverLocked
          const merged=serverLocked&&pendingCount>0
            ?[...new Map([...remote.entries,...localEntries].map(entry=>[entry.id,entry])).values()]
            :remote.entries
          if(useRemote){setSession(remote.session);setEntries(merged);setExternalSlipNo(remote.session.externalSlipNo)}
          await store.putSession(useRemote?remote.session:local!)
          for(const entry of merged)await store.putEntry(entry)
          await store.putMeta(key,remote.session.id)
          if(useRemote)setMessage(`已核对原现场单 ${remote.session.sessionCode}`)
          if(useRemote&&remote.session.status==='processed')setMessage('这张单已结单。本版暂未支持同船同日新建第二张单，请在后台处理。')
        }else if(!local){setSession(null);setEntries([]);setPending(0)}
      }catch{if(isCurrent())setMessage(local?'目前离线，已载入本机现场单。':'目前离线，可继续建立本机现场单。')}
      finally{if(isCurrent())setContextLoading(false)}
    })()
    return()=>{cancelled=true}
  },[sessionId,vesselId,date,productType,store,openSessionLoader,closedSessionLoader,bundleLoader])

  const refreshLocal=useCallback(async(currentSessionId:string)=>{
    if(!store)return
    const [savedEntries,operations,savedSession]=await Promise.all([
      store.getEntries(currentSessionId),store.getPending(),store.getSession(currentSessionId),
    ])
    setEntries(savedEntries);setPending(operations.filter(item=>item.sessionId===currentSessionId).length)
    if(savedSession)setSession(savedSession)
  },[store])

  const syncNow=useCallback(async()=>{
    if(!store)return
    const result=await flushWeighingQueue(store,{sync:remoteSync})
    const currentId=await store.getMeta(weighingDraftKey(productType,date,vesselId))
    if(currentId)await refreshLocal(currentId)
    if(result.failed)setMessage(`${result.lastError} 尚未同步 ${result.pending} 笔`)
  },[store,remoteSync,productType,vesselId,date,refreshLocal])

  useEffect(()=>{
    const retry=()=>{void syncNow()}
    const visible=()=>{if(document.visibilityState==='visible')retry()}
    window.addEventListener('online',retry);document.addEventListener('visibilitychange',visible)
    return()=>{window.removeEventListener('online',retry);document.removeEventListener('visibilitychange',visible)}
  },[syncNow])

  function switchProduct(next:WeighingProductType){
    setContextLoading(true);setProductType(next);setEntryMode('individual');setWeight('');setRemark('');setError('')
    queueMicrotask(()=>weightRef.current?.focus())
  }

  async function selectSpecies(item:FishSpeciesRecord){
    if(!item.active){setError('这个鱼名已停用，请到主资料重新启用，或输入其他鱼名。');return}
    setSpeciesId(item.id);setWeight('');setError('');queueMicrotask(()=>weightRef.current?.focus())
    if(species.some(existing=>existing.id===item.id))return
    try{const saved=await speciesCreator(item);setSpecies(current=>[...current,saved])}
    catch{setError('默认鱼名建立失败，请连接网络后重试。')}
  }

  async function selectVessel(nextId:string){
    setContextLoading(true);setVesselId(nextId);setWeight('');setError('')
  }

  async function confirmEntry(event?:FormEvent){
    event?.preventDefault()
    if(saveLock.current||busy||contextLoading||locked||!store||!selectedVessel)return
    let vesselForEntry=selectedVessel
    if(vesselForEntry.id===vesselForEntry.vesselCode&&!vesselForEntry.createdBy){
      try{
        const initialized=await vesselInitializer()
        const resolved=visibleVessels(initialized).find(item=>item.vesselCode===vesselForEntry.vesselCode)
        if(!resolved){setError('无法建立默认船号，请连接网络后重试。');return}
        vesselForEntry=resolved;setVessels(visibleVessels(initialized));setVesselId(resolved.id)
      }catch{setError('无法建立默认船号，请连接网络后重试。');return}
    }
    let grams:number
    try{grams=kgInputToGrams(weight,entryMode)}catch(problem){setError(problem instanceof Error?problem.message:'重量格式不正确。');return}
    let speciesForEntry=displayedSpecies.find(item=>item.id===speciesId)
    if(productType==='fish_head'&&!speciesForEntry){setError('请选择鱼名。');return}
    if(productType==='fish_head'&&speciesForEntry&&!species.some(item=>item.id===speciesForEntry!.id)){
      try{
        const initialized=await speciesInitializer(species)
        const resolved=initialized.find(item=>item.speciesCode===speciesForEntry!.speciesCode)
        if(!resolved||!resolved.active){setError('无法建立默认鱼名，请连接网络后重试。');return}
        speciesForEntry=resolved;setSpecies(initialized);setSpeciesId(resolved.id)
      }catch{setError('无法建立默认鱼名，请连接网络后重试。');return}
    }
    const recordedAtClient=now(),base=session??newWeighingSession({
      id:idFactory('session'),productType,vesselId:vesselForEntry.id,vesselCodeSnapshot:vesselForEntry.vesselCode,
      vesselNameSnapshot:vesselForEntry.displayName,weighingDate:date,externalSlipNo,
    })
    const entryId=idFactory('entry')
    let entry:WeighingEntry
    try{
      entry=buildWeighingEntry({id:entryId,clientEntryId:entryId,sessionId:base.id,productType,
        receiptNoSnapshot:base.sessionCode,
        weighingDate:base.weighingDate,monthKey:base.monthKey,vesselId:base.vesselId,vesselCodeSnapshot:base.vesselCodeSnapshot,
        fishSpeciesId:productType==='fish_head'?speciesForEntry!.id:null,fishSpecies:productType==='fish_head'?speciesForEntry:null,
        fishMealQuality:productType==='fish_meal'?quality:null,entryMode,
        sequenceNo:entryMode==='individual'?base.lastSequenceNo+1:null,weightGrams:grams,remark,
        recordedAtClient,recordedAt:recordedAtClient,recordedBy:auth.currentUser?.uid??'local-user'})
    }catch(problem){setError(problem instanceof Error?problem.message:'无法建立称重记录。');return}
    const next=applyEntryCreated(base,entry),operationId=`entry_create_${entry.clientEntryId}`
    saveLock.current=true;setBusy(true);setError('')
    try{
      // A virtual default vessel can finish initializing while this first basket is
      // being saved. Its stale context loader must not overwrite this new draft.
      contextRequest.current+=1
      await store.commitOperation({session:next,entry:{...entry,syncStatus:'syncing'},
        operation:{id:operationId,type:'entry_create',sessionId:base.id,entryId:entry.id,
          createdAtClient:recordedAtClient,payload:{session:base,entry}},
        meta:{[weighingDraftKey(productType,date,vesselForEntry.id)]:base.id,lastVesselId:vesselForEntry.id}})
      setSession(next);setEntries(current=>[{...entry,syncStatus:'syncing'},...current]);setPending(current=>current+1)
      setWeight('');if(entryMode==='total')setRemark('')
      setMessage('已保存');window.dispatchEvent(new Event('ccm:form-saved'));navigator.vibrate?.(40);queueMicrotask(()=>weightRef.current?.focus())
      await syncNow()
    }finally{saveLock.current=false;setBusy(false)}
  }

  async function queueVoid(entry:WeighingEntry,reason:string){
    if(!store||!session)return
    const result=softVoidWeighingEntry(session,entry,reason),operationId=`entry_void_${entry.id}_${result.entry.revision}`
    await store.commitOperation({session:result.session,entry:{...result.entry,syncStatus:'syncing'},
      operation:{id:operationId,type:'entry_void',sessionId:session.id,entryId:entry.id,
        createdAtClient:now(),payload:{before:entry,after:result.entry}}})
    setSession(result.session);setEntries(current=>current.map(item=>item.id===entry.id?{...result.entry,syncStatus:'syncing'}:item))
    setPending(current=>current+1);setEditing(null);setMessage('已作废，等待同步');window.dispatchEvent(new Event('ccm:form-saved'));await syncNow()
  }

  async function undoLatest(){
    if(!latestIndividual)return
    if(!window.confirm(`撤回最近一篮：${latestIndividual.displayNameSnapshot} ${formatWeightKg(latestIndividual.weightGrams)} kg？`))return
    await queueVoid(latestIndividual,'撤回上一篮')
  }

  async function updateEntry(before:WeighingEntry,after:WeighingEntry){
    if(!store||!session)return
    const nextSession=applyEntryReplacement(session,before,after),operationId=`entry_update_${after.id}_${after.revision}`
    await store.commitOperation({session:nextSession,entry:{...after,syncStatus:'syncing'},
      operation:{id:operationId,type:'entry_update',sessionId:session.id,entryId:after.id,
        createdAtClient:now(),payload:{before,after}}})
    setSession(nextSession);setEntries(current=>current.map(item=>item.id===after.id?{...after,syncStatus:'syncing'}:item))
    setPending(current=>current+1);setEditing(null);setMessage('修改已保存，等待同步');window.dispatchEvent(new Event('ccm:form-saved'));await syncNow()
  }

  async function complete(){
    if(!store||!session)return
    const local={...session,status:'completed' as const,revision:session.revision+1}
    const operationId=`complete_${session.id}_${local.revision}`
    await store.commitOperation({session:local,operation:{id:operationId,type:'complete',sessionId:session.id,
      entryId:null,createdAtClient:now(),payload:{session:local}}})
    setSession(local);setPending(current=>current+1);setShowComplete(false);setMessage('已完成，等待同步');await syncNow()
  }

  async function addCustomSpecies(value:{displayName:string;save:boolean}){
    const displayName=value.displayName.trim()
    if(!displayName){throw new Error('自定义鱼名必须填写名称。')}
    const matching=species.find(item=>item.displayName===displayName)
    if(matching){
      if(!matching.active)throw new Error('这个鱼名已停用，请到主资料重新启用，或输入其他鱼名。')
      setSpeciesId(matching.id);setShowCustomSpecies(false);queueMicrotask(()=>weightRef.current?.focus());return
    }
    const id=`custom_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,7)}`
    const record:FishSpeciesRecord={id,speciesCode:id,displayName,active:true,order:Math.max(16,...species.map(item=>item.order))+1,notes:''}
    const saved=await speciesCreator(record)
    setSpecies(current=>[...current,saved]);setSpeciesId(saved.id);setShowCustomSpecies(false)
    queueMicrotask(()=>weightRef.current?.focus())
  }

  return <main className="weighing-page">
    <header className="weighing-header"><div><p className="eyebrow">CCM Fishery</p><h1>{pageTitle}</h1></div>
      <Link to="/weighing">查看现场单</Link></header>
    <section className="weighing-setup">
      <label className="vessel-choice">船号<select aria-label="船号" value={vesselId} onChange={event=>void selectVessel(event.target.value)}>
        <option value="">请选择船号</option>{vessels.map(item=><option key={item.id} value={item.id}>{item.vesselCode}</option>)}</select></label>
      <label>日期<input aria-label="日期" placeholder="DD/MM/YYYY" value={date} onChange={event=>{setContextLoading(true);setDate(event.target.value)}}/><small>{formatMalaysiaDate(date)}</small></label>
      <label className="slip-field">手写单号（可选）<input value={externalSlipNo} disabled={Boolean(session)} onChange={event=>setExternalSlipNo(event.target.value)}/></label>
    </section>

    {species.length===0&&<p className="notice">正在显示 CCM 默认鱼名；选择后会安全补齐主资料。</p>}
    <section className="weighing-core">
      {!fixedProductType&&<div className="product-switch" role="group" aria-label="产品类型">
        <button type="button" aria-pressed={productType==='fish_head'} className={productType==='fish_head'?'selected':''} onClick={()=>switchProduct('fish_head')}>鱼头</button>
        <button type="button" aria-pressed={productType==='fish_meal'} className={productType==='fish_meal'?'selected':''} onClick={()=>switchProduct('fish_meal')}>鱼仔</button>
      </div>}
      {productType==='fish_head'?<div className="species-grid" role="group" aria-label="鱼名">
        {displayedSpecies.map(item=><button type="button" key={item.id} aria-pressed={speciesId===item.id} disabled={!item.active}
          className={speciesId===item.id?'selected':''} onClick={()=>void selectSpecies(item)}>{item.displayName}</button>)}
        <button type="button" className="custom-species-button" onClick={()=>setShowCustomSpecies(true)}>其他</button>
      </div>:<>
        <div className="quality-grid" role="group" aria-label="鱼仔品质">
          {FISH_MEAL_QUALITIES.map(item=><button type="button" key={item.id} aria-pressed={quality===item.id}
            className={quality===item.id?'selected':''} onClick={()=>{setQuality(item.id);weightRef.current?.focus()}}>{item.name}</button>)}
        </div>
        <div className="entry-mode-switch" role="group" aria-label="录入方式">
          <button type="button" aria-pressed={entryMode==='individual'} className={entryMode==='individual'?'selected':''} onClick={()=>setEntryMode('individual')}>逐篮</button>
          <button type="button" aria-pressed={entryMode==='total'} className={entryMode==='total'?'selected':''} onClick={()=>setEntryMode('total')}>总重量</button>
        </div>
      </>}
      <p className="current-selection">已选择：<strong>{productType==='fish_head'?displayedSpecies.find(item=>item.id===speciesId)?.displayName:FISH_MEAL_QUALITIES.find(item=>item.id===quality)?.name}</strong></p>
      <p className="session-code">{productType==='fish_head'?'鱼头单号':'鱼仔单号'}：<strong>{session?.sessionCode??'保存首笔重量后建立'}</strong></p>
      <form className="weighing-input-bar" onSubmit={confirmEntry}>
        <label><span>重量（kg）</span><input ref={weightRef} aria-label="重量（kg）" inputMode="decimal" enterKeyHint="done"
          disabled={locked||contextLoading} value={weight} onChange={event=>setWeight(event.target.value)}
          onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();void confirmEntry()}}}/></label>
      </form>
      <DecimalKeypad value={weight} onChange={setWeight} onConfirm={()=>void confirmEntry()} disabled={busy||contextLoading||locked||!vesselId}/>
      {productType==='fish_meal'&&entryMode==='total'&&<label className="total-remark">备注
        <input aria-label="备注" value={remark} maxLength={100} placeholder="例如：总共48包" onChange={event=>setRemark(event.target.value)}/></label>}
      {error&&<p className="error" role="alert">{error} <button type="button" onClick={()=>{setError('');setReferenceAttempt(current=>current+1)}}>重试</button></p>}
      {message&&<p className="weighing-message" role="status">{message}</p>}
      <div className="recent-entry">
        <div><small>最近一篮</small>{latest?<><strong>{latest.displayNameSnapshot}</strong><span>{formatWeightKg(latest.weightGrams)} kg</span></>:<span>尚无记录</span>}</div>
        <button type="button" className="undo-entry" disabled={!latestIndividual||locked} onClick={()=>void undoLatest()}>撤回</button>
      </div>
      <div className="weighing-compact-summary">
        <strong>{summary.basketCount} 篮</strong><strong>{formatWeightKg(summary.totalWeightGrams)} kg</strong>
        <span>{pending>0?`尚未同步 ${pending} 笔`:'全部已同步'}</span>
        {pending>0&&<button type="button" onClick={()=>void syncNow()}>重新同步</button>}
      </div>
      <section className="weighing-live-summary" aria-label="现场汇总"><h2>现场汇总</h2><CategorySummary entries={entries}/></section>
    </section>

    {locked&&<p className="session-lock">{session?.status==='completed'?'已完成称重，手机端已锁定。':
      session?.status==='processed'?'已结单，现场录入已锁定。':'现场单已作废。'}</p>}

    <section className="weighing-history"><h2>完整历史记录</h2>
      <div className="weighing-entry-list">{entries.map(item=><button type="button" key={item.id}
        className={`weighing-entry-row ${item.voided?'voided':''}`} onClick={()=>setEditing(item)}>
        <span>{item.sequenceNo?`第 ${item.sequenceNo} 篮`:'总重'}</span><strong>{item.displayNameSnapshot}</strong>
        <b>{formatWeightKg(item.weightGrams)} kg</b><small>{entryTime(item.recordedAtClient)}</small>
        <em>{item.voided?'已作废':item.syncStatus==='synced'?'已同步':item.syncStatus==='failed'?'同步失败':'尚未同步'}</em>
      </button>)}</div>
    </section>
    {!locked&&activeEntries.length>0&&<button className="complete-weighing" type="button" onClick={()=>setShowComplete(true)}>完成称重</button>}
    {session?.status==='completed'&&<Link className="primary-action settlement-link" to={`/weighing/${session.id}/review`}>去结单</Link>}
    {showComplete&&session&&<CompleteDialog session={session} pending={pending} close={()=>setShowComplete(false)} confirm={()=>void complete()}/>}
    {editing&&session&&<EntryDialog entry={editing} species={activeSpecies} locked={locked} close={()=>setEditing(null)}
      save={after=>updateEntry(editing,after)} voidEntry={reason=>queueVoid(editing,reason)}/>}
    {showCustomSpecies ? <CustomSpeciesDialog close={()=>setShowCustomSpecies(false)} save={addCustomSpecies}/> : null}
  </main>
}

function CustomSpeciesDialog({close,save}:{close:()=>void;save:(value:{displayName:string;save:boolean})=>Promise<void>}){
  const [displayName,setDisplayName]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false)
  async function submit(event:FormEvent){event.preventDefault();setBusy(true);setError('');try{await save({displayName,save:true})}catch(problem){setError(problem instanceof Error?problem.message:'无法保存其他鱼名。')}finally{setBusy(false)}}
  return <div className="dialog-backdrop"><section className="form-dialog" role="dialog" aria-modal="true"><h2>自定义鱼名</h2><form className="master-form" onSubmit={submit}>
    <label>鱼名<input aria-label="自定义鱼名" value={displayName} maxLength={80} onChange={event=>setDisplayName(event.target.value)}/></label>
    {error&&<p className="error" role="alert">{error}</p>}<button className="primary-action" disabled={busy}>建立并选择</button><button type="button" onClick={close}>取消</button>
  </form></section></div>
}

function entryTime(value:string){
  const date=new Date(value)
  return Number.isNaN(date.getTime())?'—':new Intl.DateTimeFormat('zh-CN',{
    timeZone:'Asia/Kuala_Lumpur',hour:'2-digit',minute:'2-digit',hour12:false,
  }).format(date)
}

function CategorySummary({entries}:{entries:WeighingEntry[]}){
  const groups=new Map<string,{name:string;baskets:number;individualGrams:number;totalGrams:number}>()
  entries.filter(item=>!item.voided).forEach(item=>{
    const key=item.productType==='fish_head'?`species:${item.fishSpeciesCodeSnapshot}`:`meal:${item.fishMealQuality}`
    const current=groups.get(key)??{name:item.displayNameSnapshot,baskets:0,individualGrams:0,totalGrams:0}
    if(item.entryMode==='individual'){current.baskets+=1;current.individualGrams+=item.weightGrams}
    else current.totalGrams+=item.weightGrams
    groups.set(key,current)
  })
  return <ul>{[...groups.values()].map(item=><li key={item.name}><strong>{item.name}</strong><span>{item.baskets} 篮 · 逐篮 {formatWeightKg(item.individualGrams)} kg
    {item.totalGrams>0&&` · 总重记录 ${formatWeightKg(item.totalGrams)} kg`} · 合计 {formatWeightKg(item.individualGrams+item.totalGrams)} kg</span></li>)}</ul>
}

function CompleteDialog({session,pending,close,confirm}:{session:WeighingSession;pending:number;close:()=>void;confirm:()=>void}){
  return <div className="dialog-backdrop"><section className="form-dialog complete-dialog" role="dialog" aria-modal="true">
    <h2>确认完成称重</h2><p>{session.vesselCodeSnapshot} · {formatMalaysiaDate(session.weighingDate)}</p>
    <dl><div><dt>鱼头</dt><dd>{session.fishHeadBasketCount} 篮 · {formatWeightKg(session.fishHeadWeightGrams)} kg</dd></div>
      <div><dt>桶鱼仔</dt><dd>{session.fishMealBucketBasketCount} 篮 · {formatWeightKg(session.fishMealBucketWeightGrams)} kg</dd></div>
      <div><dt>包鱼仔</dt><dd>{session.fishMealBagBasketCount} 篮 · {formatWeightKg(session.fishMealBagWeightGrams)} kg</dd></div>
      <div><dt>总重量</dt><dd>{formatWeightKg(session.totalWeightGrams)} kg</dd></div></dl>
    <p>{pending>0?`尚未同步 ${pending} 笔；系统会先同步记录，再完成现场单。`:'全部记录已同步。'}</p>
    <button className="primary-action" onClick={confirm}>确认完成</button><button onClick={close}>取消</button>
  </section></div>
}

function EntryDialog({entry,species,locked,close,save,voidEntry}:{entry:WeighingEntry;species:FishSpeciesRecord[];locked:boolean;
  close:()=>void;save:(after:WeighingEntry)=>Promise<void>;voidEntry:(reason:string)=>Promise<void>}){
  const [weight,setWeight]=useState(formatWeightKg(entry.weightGrams))
  const [speciesId,setSpeciesId]=useState(entry.fishSpeciesId??'')
  const [quality,setQuality]=useState<FishMealQuality>(entry.fishMealQuality??'bucket')
  const [reason,setReason]=useState('')
  const [error,setError]=useState('')
  async function submit(event:FormEvent){event.preventDefault()
    try{
      const grams=kgInputToGrams(weight,entry.entryMode),selected=species.find(item=>item.id===speciesId)
      const rebuilt=buildWeighingEntry({id:entry.id,clientEntryId:entry.clientEntryId,sessionId:entry.sessionId,
        productType:entry.productType,fishSpeciesId:entry.productType==='fish_head'?speciesId:null,
        fishSpecies:entry.productType==='fish_head'?selected:null,fishMealQuality:entry.productType==='fish_meal'?quality:null,
        entryMode:entry.entryMode,sequenceNo:entry.sequenceNo,weightGrams:grams,
        unitPriceCentsPerKg:entry.unitPriceCentsPerKg,remark:entry.remark,
        weighingDate:entry.weighingDate,monthKey:entry.monthKey,vesselId:entry.vesselId,vesselCodeSnapshot:entry.vesselCodeSnapshot,
        recordedAtClient:entry.recordedAtClient,recordedAt:entry.recordedAt,recordedBy:entry.recordedBy})
      await save({...rebuilt,revision:entry.revision+1,syncStatus:'syncing'})
    }catch(problem){setError(problem instanceof Error?problem.message:'修改失败。')}
  }
  return <div className="dialog-backdrop"><section className="form-dialog" role="dialog" aria-modal="true"><h2>查看记录</h2>
    <p>修订版本：{entry.revision}{entry.voided&&` · 已作废：${entry.voidReason}`}</p>
    <form className="master-form" onSubmit={submit}>
      {entry.productType==='fish_head'?<fieldset><legend>鱼名</legend><div className="species-grid">
        {species.map(item=><button type="button" key={item.id} className={speciesId===item.id?'selected':''} disabled={locked||entry.voided} onClick={()=>setSpeciesId(item.id)}>{item.displayName}</button>)}</div></fieldset>:
        <label>鱼仔品质<select value={quality} disabled={locked||entry.voided} onChange={event=>setQuality(event.target.value as FishMealQuality)}>
          <option value="bucket">桶鱼仔</option><option value="bag">包鱼仔</option></select></label>}
      <label>重量（kg）<input value={weight} disabled={locked||entry.voided} onChange={event=>setWeight(event.target.value)}/></label>
      {!locked&&!entry.voided&&<button className="primary-action">保存修改</button>}
    </form>
    {!locked&&!entry.voided&&<div className="void-entry-panel"><label>作废原因<input value={reason} onChange={event=>setReason(event.target.value)}/></label>
      <button className="danger-action" onClick={()=>void voidEntry(reason||'错误记录')}>作废</button></div>}
    {error&&<p className="error" role="alert">{error}</p>}<button onClick={close}>关闭</button>
  </section></div>
}
