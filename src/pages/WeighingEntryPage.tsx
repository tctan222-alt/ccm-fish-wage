import { useCallback,useEffect,useMemo,useRef,useState,type FormEvent } from 'react'
import { useUnsavedChanges, useUnsavedForm } from '../components/dirtyState'
import { Link,useParams } from 'react-router-dom'
import { auth } from '../firebase'
import { DEFAULT_VESSELS,type Vessel } from '../lib/purchasing'
import { DecimalKeypad } from '../components/DecimalKeypad'
import { FishHeadLiveSummary } from '../components/FishHeadLiveSummary'
import { malaysiaBusinessDate } from '../lib/businessDate'
import {
  FISH_MEAL_QUALITIES,
  DEFAULT_FISH_SPECIES,
  activeFishSpecies,
  applyEntryCreated,
  applyEntryReplacement,
  canModifyWeighing,
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
  const [vesselId,setVesselId]=useState(sessionId?'':DEFAULT_VESSELS[0].id)
  const [date,setDate]=useState(today())
  const [externalSlipNo,setExternalSlipNo]=useState('')
  const [session,setSession]=useState<WeighingSession|null>(null)
  const [entries,setEntries]=useState<WeighingEntry[]>([])
  const [productType,setProductType]=useState<WeighingProductType>(fixedProductType??'fish_head')
  const [speciesId,setSpeciesId]=useState(DEFAULT_FISH_SPECIES[0].id)
  const [quality,setQuality]=useState<FishMealQuality|''>('')
  const [entryMode,setEntryMode]=useState<WeighingEntryMode>('individual')
  const [weight,setWeight]=useState('')
  const [remark,setRemark]=useState('')
  const [pending,setPending]=useState(0)
  const [busy,setBusy]=useState(false)
  const [entryMutationBusy,setEntryMutationBusy]=useState(false)
  const [syncing,setSyncing]=useState(false)
  const [syncError,setSyncError]=useState('')
  const [message,setMessage]=useState('')
  const [error,setError]=useState('')
  const [referenceAttempt,setReferenceAttempt]=useState(0)
  const [showComplete,setShowComplete]=useState(false)
  const [editing,setEditing]=useState<WeighingEntry|null>(null)
  const [showCustomSpecies,setShowCustomSpecies]=useState(false)
  const [contextLoading,setContextLoading]=useState(true)
  const [checkedContext,setCheckedContext]=useState('')
  const [referencesReady,setReferencesReady]=useState(false)
  useUnsavedChanges(!!weight || !!remark || externalSlipNo !== (session?.externalSlipNo ?? ''))
  const vesselSelection=useRef<Vessel>(DEFAULT_VESSELS[0])
  const vesselSelectedByUser=useRef(false)
  const speciesSelection=useRef<FishSpeciesRecord>(DEFAULT_FISH_SPECIES[0])
  const addedSpecies=useRef<FishSpeciesRecord[]>([])
  const weightRef=useRef<HTMLInputElement>(null)
  const refocusAfterSave=useRef(false)
  const saveLock=useRef(false)
  const entryMutationLock=useRef(false)
  const contextRequest=useRef(0)

  const store=offlineStore
  const activeSpecies=useMemo(()=>activeFishSpecies(species),[species])
  const displayedSpecies=useMemo(()=>visibleFishSpecies(species),[species])
  const contextMatchesSession=!sessionId||Boolean(session&&session.vesselId===vesselId&&session.weighingDate===date&&session.productType===productType)
  const contextEntries=contextMatchesSession?entries:[]
  const activeContextEntries=contextEntries.filter(item=>!item.voided)
  const summary=summarizeWeighingEntries(contextEntries)
  const latestIndividual=activeContextEntries.filter(item=>item.entryMode==='individual')
    .reduce<WeighingEntry|undefined>((latest,item)=>!latest||(item.sequenceNo??0)>(latest.sequenceNo??0)?item:latest,undefined)
  const latest=productType==='fish_head'?latestIndividual:activeContextEntries[0]
  const selectedVessel=vessels.find(item=>item.id===vesselId)
  const locked=Boolean(session&&(session.status!=='weighing'||!canModifyWeighing(session,new Date(now()))))
  let contextKey=''
  try{contextKey=sessionId?`session:${sessionId}`:weighingDraftKey(productType,date,vesselId)}catch{/* A partially typed date cannot be saved. */}
  const contextPending=contextLoading||checkedContext!==contextKey||Boolean(sessionId&&session?.id!==sessionId)
  const savePending=!contextKey||contextPending||!referencesReady

  useEffect(()=>{if(fixedProductType)setProductType(fixedProductType)},[fixedProductType])
  useEffect(()=>{if(!busy&&refocusAfterSave.current){refocusAfterSave.current=false;weightRef.current?.focus()}},[busy])

  useEffect(()=>{
    let cancelled=false
    let vesselsRefreshed=false,speciesRefreshed=false
    let preferredVesselId:string|undefined
    let latestVessels:Vessel[]=DEFAULT_VESSELS
    function applyVessels(rows:Vessel[],preferred=preferredVesselId){
      latestVessels=rows
      const available=visibleVessels(rows)
      setVessels(available)
      if(sessionId)return
      const previous=vesselSelection.current
      const next=(!vesselSelectedByUser.current&&preferred?available.find(item=>item.id===preferred):undefined)
        ??available.find(item=>item.id===previous.id||item.vesselCode===previous.vesselCode)
      // Keep the chosen identity if it was removed/disabled; never switch a typed
      // basket to another vessel. Confirmation stays disabled until reselected.
      if(next){vesselSelection.current=next;setVesselId(next.id)}
    }
    function applySpecies(rows:FishSpeciesRecord[]){
      const combined=[...rows,...addedSpecies.current.filter(item=>!rows.some(row=>row.id===item.id))]
      setSpecies(combined)
      const previous=speciesSelection.current
      const next=visibleFishSpecies(combined).find(item=>item.id===previous.id||item.speciesCode===previous.speciesCode)
      if(next){speciesSelection.current=next;setSpeciesId(next.id)}
    }
    // IndexedDB is independent of the network. A late cache read must not roll
    // back a newer server response or a selection made since the page opened.
    if(store)void Promise.all([store.getMeta('reference:vessels'),store.getMeta('reference:species'),store.getMeta('lastVesselId')])
      .then(([cachedVessels,cachedSpecies,preferred])=>{
        if(cancelled)return
        preferredVesselId=preferred
        const vesselRows=parseCachedRows<Vessel>(cachedVessels),speciesRows=parseCachedRows<FishSpeciesRecord>(cachedSpecies)
        applyVessels(vesselsRefreshed?latestVessels:vesselRows??DEFAULT_VESSELS)
        if(!speciesRefreshed&&speciesRows)applySpecies(speciesRows)
        if(vesselRows&&speciesRows)setReferencesReady(true)
      }).catch(()=>{if(!cancelled)setError('无法读取本机参考资料缓存，仍可输入重量，正在从网络更新。')})
    void (async()=>{
      const [vesselResult,speciesResult]=await Promise.allSettled([vesselLoader(),speciesLoader()])
      if(cancelled)return
      // Keep cached rows when refresh fails; defaults are already on screen.
      if(vesselResult.status==='fulfilled')applyVessels(vesselResult.value)
      if(speciesResult.status==='fulfilled')applySpecies(speciesResult.value)
      vesselsRefreshed=vesselResult.status==='fulfilled';speciesRefreshed=speciesResult.status==='fulfilled'
      setReferencesReady(true)
      const cacheWrites=[]
      if(store&&vesselResult.status==='fulfilled')cacheWrites.push(store.putMeta('reference:vessels',JSON.stringify(vesselResult.value)))
      if(store&&speciesResult.status==='fulfilled')cacheWrites.push(store.putMeta('reference:species',JSON.stringify(speciesResult.value)))
      void Promise.all(cacheWrites).catch(()=>{if(!cancelled)setError('参考资料已更新，但无法保存本机缓存。')})
      if(vesselResult.status==='fulfilled'&&DEFAULT_VESSELS.some(item=>!vesselResult.value.some(row=>row.vesselCode===item.vesselCode))){
        void vesselInitializer().then(next=>{if(!cancelled)applyVessels(next)}).catch(()=>undefined)
      }
      if(speciesResult.status==='fulfilled'&&DEFAULT_FISH_SPECIES.some(item=>!speciesResult.value.some(row=>row.speciesCode===item.speciesCode))){
        void speciesInitializer(speciesResult.value).then(next=>{if(!cancelled)applySpecies(next)}).catch(()=>undefined)
      }
      if(vesselResult.status==='rejected'||speciesResult.status==='rejected'){
        setError('无法载入船号或鱼名资料，正在显示本机默认资料。')
      }
    })()
    return()=>{cancelled=true}
  },[vesselLoader,speciesLoader,store,referenceAttempt,vesselInitializer,speciesInitializer,sessionId])

  useEffect(()=>{
    let cancelled=false
    if(sessionId){
      contextRequest.current+=1
      setContextLoading(true);setSession(null);setEntries([]);setPending(0);setSyncError('');setSyncing(false);setMessage('')
      void bundleLoader(sessionId).then(async bundle=>{
        if(cancelled)return
        if(store){
          const operations=(await store.getPending()).filter(item=>item.sessionId===sessionId)
          const local=await store.getSession(sessionId)
          if(local&&operations.length>0){
            const localEntries=await store.getEntries(sessionId)
            bundle={session:bundle.session.status==='weighing'?local:bundle.session,
              entries:[...new Map([...bundle.entries,...localEntries].map(entry=>[entry.id,entry])).values()]}
          }
          if(cancelled)return
          setPending(operations.length)
          await store.putSession(bundle.session)
          for(const entry of bundle.entries)await store.putEntry(entry)
          await store.putMeta(weighingDraftKey(bundle.session.productType??'fish_head',bundle.session.weighingDate,bundle.session.vesselId),bundle.session.id)
        }
        if(cancelled)return
        setSession(bundle.session);setEntries(bundle.entries);setVesselId(bundle.session.vesselId)
        setDate(bundle.session.weighingDate);setExternalSlipNo(bundle.session.externalSlipNo)
        if(bundle.session.productType)setProductType(bundle.session.productType)
      }).catch(()=>{if(!cancelled)setError('无法载入现场称重单。')}).finally(()=>{if(!cancelled){setContextLoading(false);setCheckedContext(`session:${sessionId}`)}})
    }
    return()=>{cancelled=true}
  },[sessionId,bundleLoader,store])

  useEffect(()=>{
    if(sessionId||!vesselId||!store){if(!sessionId)setContextLoading(false);return}
    let cancelled=false
    const request=++contextRequest.current
    const isCurrent=()=>!cancelled&&request===contextRequest.current
    setContextLoading(true)
    void (async()=>{
      let local:WeighingSession|undefined,localEntries:WeighingEntry[]=[],pendingCount=0,localId:string|undefined
      try{
        if(!contextKey){setError('请填写有效日期后再确认重量。');return}
        const key=contextKey
        setSession(null);setEntries([]);setPending(0);setExternalSlipNo('');setSyncError('');setSyncing(false);setMessage('')
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
      finally{if(isCurrent()){setContextLoading(false);setCheckedContext(contextKey)}}
    })()
    return()=>{cancelled=true}
  },[sessionId,vesselId,date,productType,store,openSessionLoader,closedSessionLoader,bundleLoader,contextKey])

  const refreshLocal=useCallback(async(currentSessionId:string,request:number)=>{
    if(!store)return
    const [savedEntries,operations,savedSession]=await Promise.all([
      store.getEntries(currentSessionId),store.getPending(),store.getSession(currentSessionId),
    ])
    if(request!==contextRequest.current)return
    setEntries(savedEntries);setPending(operations.filter(item=>item.sessionId===currentSessionId).length)
    if(savedSession)setSession(savedSession)
    return savedSession
  },[store])

  const syncNow=useCallback(async(targetSessionId?:string)=>{
    if(!store)return
    const request=contextRequest.current
    const currentId=targetSessionId??sessionId??await store.getMeta(weighingDraftKey(productType,date,vesselId))
    if(!currentId||request!==contextRequest.current)return
    setSyncing(true);setSyncError('')
    try{
      const result=await flushWeighingQueue(store,{sync:remoteSync,sessionId:currentId})
      const savedSession=await refreshLocal(currentId,request)
      if(request!==contextRequest.current)return
      if(result.failed)setSyncError(`同步未完成：${result.lastError}。记录仍保留在本机，请重试。`)
      else if(savedSession?.status==='completed'&&result.pending===0)setMessage('已完成称重，可以查看结单。')
      else if(result.pending===0)setMessage(current=>current.replace('已保存在本机，等待同步','已保存并同步'))
    }catch(problem){
      if(request===contextRequest.current)setSyncError(`同步未完成：${problem instanceof Error?problem.message:'请稍后重试。'}。记录仍保留在本机。`)
    }finally{if(request===contextRequest.current)setSyncing(false)}
  },[store,remoteSync,sessionId,productType,vesselId,date,refreshLocal])

  useEffect(()=>{
    if(!contextLoading&&session?.status==='completed'&&pending>0&&!saveLock.current&&(!sessionId||session.id===sessionId))void syncNow(session.id)
  },[contextLoading,sessionId,session?.id,session?.status,pending,syncNow])

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

  function selectSpecies(item:FishSpeciesRecord){
    if(!item.active){setError('这个鱼名已停用，请到主资料重新启用，或输入其他鱼名。');return}
    speciesSelection.current=item
    setSpeciesId(item.id);setWeight('');setError('');queueMicrotask(()=>weightRef.current?.focus())
  }

  async function selectVessel(nextId:string){
    vesselSelectedByUser.current=true
    vesselSelection.current=vessels.find(item=>item.id===nextId)??vesselSelection.current
    setContextLoading(true);setVesselId(nextId);setWeight('');setError('')
  }

  async function confirmEntry(event?:FormEvent){
    event?.preventDefault()
    if(saveLock.current||entryMutationLock.current||busy||savePending||locked||!store||!selectedVessel?.active)return
    const request=contextRequest.current
    saveLock.current=true;setBusy(true);setError('')
    try{await saveEntry(request)}
    catch(problem){setError(problem instanceof Error?problem.message:'无法保存重量，请重试。')}
    finally{saveLock.current=false;setBusy(false)}
  }

  function changeWeight(value:string){
    if(value)vesselSelectedByUser.current=true
    setWeight(value)
  }

  async function saveEntry(request:number){
    if(!store||!selectedVessel)return
    let vesselForEntry=selectedVessel
    if(vesselForEntry.id===vesselForEntry.vesselCode&&!vesselForEntry.createdBy){
      try{
        const initialized=await vesselInitializer()
        if(request!==contextRequest.current)return
        const resolved=visibleVessels(initialized).find(item=>item.vesselCode===vesselForEntry.vesselCode)
        if(!resolved){setError('无法建立默认船号，请连接网络后重试。');return}
        vesselForEntry=resolved;setVessels(visibleVessels(initialized));setVesselId(resolved.id);vesselSelection.current=resolved
        if(resolved.id!==vesselId){setContextLoading(true);setMessage('船号资料已更新，正在核对现场单；重量已保留，请核对后确认。');return}
      }catch{setError('无法建立默认船号，请连接网络后重试。');return}
    }
    let grams:number
    try{grams=kgInputToGrams(weight,entryMode)}catch(problem){setError(problem instanceof Error?problem.message:'重量格式不正确。');return}
    let speciesForEntry=displayedSpecies.find(item=>item.id===speciesId)
    if(productType==='fish_head'&&!speciesForEntry?.active){setError('请选择可用鱼名。');return}
    if(productType==='fish_head'&&speciesForEntry&&!species.some(item=>item.id===speciesForEntry!.id)){
      try{
        const initialized=await speciesInitializer(species)
        if(request!==contextRequest.current)return
        const resolved=initialized.find(item=>item.speciesCode===speciesForEntry!.speciesCode)
        if(!resolved||!resolved.active){setError('无法建立默认鱼名，请连接网络后重试。');return}
        speciesForEntry=resolved;setSpecies(initialized);setSpeciesId(resolved.id);speciesSelection.current=resolved
      }catch{setError('无法建立默认鱼名，请连接网络后重试。');return}
    }
    const recordedAtClient=now(),cleanExternalSlipNo=externalSlipNo.trim(),base=session
      ?{...session,externalSlipNo:cleanExternalSlipNo}
      :newWeighingSession({
      id:idFactory('session'),productType,vesselId:vesselForEntry.id,vesselCodeSnapshot:vesselForEntry.vesselCode,
      vesselNameSnapshot:vesselForEntry.displayName,weighingDate:date,externalSlipNo:cleanExternalSlipNo,
    })
    const entryId=idFactory('entry')
    let entry:WeighingEntry
    try{
      entry=buildWeighingEntry({id:entryId,clientEntryId:entryId,sessionId:base.id,productType,
        weighingDate:base.weighingDate,monthKey:base.monthKey,vesselId:base.vesselId,vesselCodeSnapshot:base.vesselCodeSnapshot,
        fishSpeciesId:productType==='fish_head'?speciesForEntry!.id:null,fishSpecies:productType==='fish_head'?speciesForEntry:null,
        fishMealQuality:productType==='fish_meal'?quality||null:null,entryMode,
        sequenceNo:entryMode==='individual'?base.lastSequenceNo+1:null,weightGrams:grams,remark,
        recordedAtClient,recordedAt:recordedAtClient,recordedBy:auth.currentUser?.uid??'local-user'})
    }catch(problem){setError(problem instanceof Error?problem.message:'无法建立称重记录。');return}
    const next=applyEntryCreated(base,entry),operationId=`entry_create_${entry.clientEntryId}`
    if(request!==contextRequest.current)return
    // Invalidate any older context callback before committing the checked draft.
    contextRequest.current+=1
    await store.commitOperation({session:next,entry:{...entry,syncStatus:'syncing'},
      operation:{id:operationId,type:'entry_create',sessionId:base.id,entryId:entry.id,
        createdAtClient:recordedAtClient,payload:{session:base,entry}},
      meta:{[weighingDraftKey(productType,date,vesselForEntry.id)]:base.id,lastVesselId:vesselForEntry.id}})
    setSession(next);setEntries(current=>[{...entry,syncStatus:'syncing'},...current]);setPending(current=>current+1)
    setWeight('');if(entryMode==='total')setRemark('')
    refocusAfterSave.current=true
    setMessage('已保存');window.dispatchEvent(new Event('ccm:form-saved'));navigator.vibrate?.(40)
    await syncNow(base.id)
  }

  async function queueVoid(entry:WeighingEntry,reason:string){
    await commitEntryChange(entry,{reason})
  }

  async function undoLatest(){
    if(!latestIndividual||locked||contextPending||entryMutationLock.current)return
    if(!window.confirm(`撤回最近一篮：${latestIndividual.displayNameSnapshot} ${formatWeightKg(latestIndividual.weightGrams)} kg？`))return
    try{await queueVoid(latestIndividual,'撤回上一篮')}
    catch(problem){setError(problem instanceof Error?problem.message:'撤回未保存，请重试。')}
  }

  async function updateEntry(before:WeighingEntry,after:WeighingEntry){
    await commitEntryChange(before,{after})
  }

  async function commitEntryChange(before:WeighingEntry,change:{after:WeighingEntry}|{reason:string}){
    if(!store||!session||locked||contextPending)throw new Error('当前现场单尚不能修改，请关闭后重新查看。')
    if(entryMutationLock.current||(busy&&!syncing))throw new Error('正在保存，请稍候再试。')
    const currentId=session.id,request=contextRequest.current
    entryMutationLock.current=true;setEntryMutationBusy(true);setError('')
    try{
      const [currentSession,currentEntries]=await Promise.all([store.getSession(currentId),store.getEntries(currentId)])
      const currentEntry=currentEntries.find(item=>item.id===before.id)
      if(request!==contextRequest.current)throw new Error('现场单已切换，请重新打开记录。')
      if(!currentSession||currentSession.status!=='weighing'||!canModifyWeighing(currentSession,new Date(now())))throw new Error('现场单已锁定，不能修改。')
      if(!currentEntry||currentEntry.voided||currentEntry.revision!==before.revision)throw new Error('记录已更新，请关闭后重新打开再修改。')
      const deleting='reason' in change
      const result=deleting?softVoidWeighingEntry(currentSession,currentEntry,change.reason)
        :{session:applyEntryReplacement(currentSession,currentEntry,change.after),entry:change.after}
      const type=deleting?'entry_void':'entry_update',after=result.entry
      await store.commitOperation({session:result.session,entry:{...after,syncStatus:'syncing'},
        operation:{id:`${type}_${after.id}_${after.revision}`,type,sessionId:currentId,entryId:after.id,
          createdAtClient:now(),payload:{before:currentEntry,after}}})
      if(request===contextRequest.current){
        setSession(result.session);setEntries(current=>current.map(item=>item.id===after.id?{...after,syncStatus:'syncing'}:item))
        setPending(current=>current+1);setEditing(null)
        setMessage(deleting?'删除已保存在本机，等待同步':'修改已保存在本机，等待同步')
      }
      window.dispatchEvent(new Event('ccm:form-saved'))
    }finally{entryMutationLock.current=false;setEntryMutationBusy(false)}
    await syncNow(currentId)
  }

  async function complete(){
    if(!store||!session||saveLock.current||entryMutationLock.current||busy||syncing||contextLoading||session.status!=='weighing')return
    const local={...session,status:'completed' as const,revision:session.revision+1}
    const operationId=`complete_${session.id}_${local.revision}`
    saveLock.current=true;setBusy(true);setError('')
    try{
      await store.commitOperation({session:local,operation:{id:operationId,type:'complete',sessionId:session.id,
        entryId:null,createdAtClient:now(),payload:{session:local}}})
      setSession(local);setPending(current=>current+1);setShowComplete(false);setMessage('正在完成称重并同步…')
      await syncNow(session.id)
    }catch(problem){setError(problem instanceof Error?problem.message:'无法保存完成申请，请重试。')}
    finally{saveLock.current=false;setBusy(false)}
  }

  async function addCustomSpecies(value:{displayName:string;save:boolean}){
    const displayName=value.displayName.trim()
    if(!displayName){throw new Error('自定义鱼名必须填写名称。')}
    const matching=species.find(item=>item.displayName===displayName)
    if(matching){
      if(!matching.active)throw new Error('这个鱼名已停用，请到主资料重新启用，或输入其他鱼名。')
      speciesSelection.current=matching;setSpeciesId(matching.id);setShowCustomSpecies(false);queueMicrotask(()=>weightRef.current?.focus());return
    }
    const id=`custom_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,7)}`
    const record:FishSpeciesRecord={id,speciesCode:id,displayName,active:true,order:Math.max(16,...species.map(item=>item.order))+1,notes:''}
    const saved=await speciesCreator(record)
    addedSpecies.current.push(saved);speciesSelection.current=saved
    setSpecies(current=>[...current,saved]);setSpeciesId(saved.id);setShowCustomSpecies(false)
    queueMicrotask(()=>weightRef.current?.focus())
  }

  return <main className="weighing-page">
    <header className="weighing-header"><div><p className="eyebrow">CCM Fishery</p><h1>{pageTitle}</h1></div>
      <Link to="/weighing">查看现场单</Link></header>
    <section className="weighing-setup">
        <label className="vessel-choice">船号<select aria-label="船号" value={vesselId} disabled={Boolean(sessionId)||busy} onChange={event=>void selectVessel(event.target.value)}>
        <option value="">请选择船号</option>{vesselId&&!selectedVessel&&<option value={vesselId} disabled>{vesselSelection.current.vesselCode}（不可用）</option>}{vessels.map(item=><option key={item.id} value={item.id}>{item.vesselCode}</option>)}</select></label>
        <label>日期<input aria-label="日期" placeholder="DD/MM/YYYY" value={date} disabled={Boolean(sessionId)||busy} onChange={event=>{setContextLoading(true);setDate(event.target.value)}}/><small>{formatMalaysiaDate(date)}</small></label>
      <label className="slip-field">{productType==='fish_head'?'鱼头单号（可之后补填）':'鱼仔单号（可之后补填）'}
        <input aria-label={productType==='fish_head'?'鱼头单号':'鱼仔单号'} value={externalSlipNo} maxLength={100} onChange={event=>setExternalSlipNo(event.target.value)}/></label>
    </section>

    {species.length===0&&<p className="notice">正在显示 CCM 默认鱼名，可先选择鱼名和输入重量。</p>}
    <section className="weighing-core">
      {!fixedProductType&&<div className="product-switch" role="group" aria-label="产品类型">
          <button type="button" aria-pressed={productType==='fish_head'} disabled={Boolean(sessionId)||busy} className={productType==='fish_head'?'selected':''} onClick={()=>switchProduct('fish_head')}>鱼头</button>
          <button type="button" aria-pressed={productType==='fish_meal'} disabled={Boolean(sessionId)||busy} className={productType==='fish_meal'?'selected':''} onClick={()=>switchProduct('fish_meal')}>鱼仔</button>
      </div>}
      {productType==='fish_head'?<div className="species-grid" role="group" aria-label="鱼名">
        {displayedSpecies.map(item=><button type="button" key={item.id} aria-pressed={speciesId===item.id} disabled={!item.active||busy}
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
          disabled={locked||busy} value={weight} onChange={event=>changeWeight(event.target.value)}
          onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();void confirmEntry()}}}/></label>
      </form>
      <DecimalKeypad value={weight} onChange={changeWeight} onConfirm={()=>void confirmEntry()} disabled={busy||locked}
        confirmDisabled={savePending||!store||!selectedVessel?.active}/>
      {savePending&&!locked&&<p className="notice" role="status">正在核对现场单…可先输入重量，核对完成后再确认。</p>}
      {!savePending&&!selectedVessel&&<p className="notice">请选择可用船号；已输入的重量仍保留。</p>}
      {productType==='fish_meal'&&entryMode==='total'&&<label className="total-remark">备注
        <input aria-label="备注" value={remark} maxLength={100} placeholder="例如：总共48包" onChange={event=>setRemark(event.target.value)}/></label>}
      {error&&<p className="error" role="alert">{error} <button type="button" onClick={()=>{setError('');setReferenceAttempt(current=>current+1)}}>重试</button></p>}
      {syncError&&<p className="error" role="alert">{syncError}</p>}
      {message&&<p className="weighing-message" role="status">{message}</p>}
      <div className="recent-entry">
        <div><small>最近一篮</small>{latest?<><strong>{latest.displayNameSnapshot}</strong><span>{formatWeightKg(latest.weightGrams)} kg</span></>:<span>尚无记录</span>}</div>
        <button type="button" className="undo-entry" disabled={!latestIndividual||locked||contextPending||entryMutationBusy||(busy&&!syncing)} onClick={()=>void undoLatest()}>撤回</button>
      </div>
      <div className="weighing-compact-summary">
        <strong>{summary.basketCount} 篮</strong><strong>{formatWeightKg(summary.totalWeightGrams)} kg</strong>
        <span>{pending>0?`尚未同步 ${pending} 笔`:'全部已同步'}</span>
        {pending>0&&<button type="button" disabled={syncing} onClick={()=>void syncNow()}>{syncing?'正在同步…':'重新同步'}</button>}
      </div>
      {activeContextEntries.length>0&&<section className="weighing-live-summary" aria-label="现场汇总"><h2>现场汇总</h2>
        {productType==='fish_head'?<FishHeadLiveSummary entries={activeContextEntries} vesselCode={session?.vesselCodeSnapshot??selectedVessel?.vesselCode??''}/>:<CategorySummary entries={activeContextEntries}/>}
      </section>}
    </section>

    {locked&&<p className="session-lock">{session?.status==='completed'?(pending>0?'完成申请已保存，等待同步。':'已完成称重，手机端已锁定。'):
      session?.status==='processed'?'已结单，现场录入已锁定。':session?.status==='voided'?'现场单已作废。':'已超过首次完成称重后的 7 天修改期，只能查看。'}</p>}

    <section className="weighing-history"><h2>完整历史记录</h2>
      {productType==='fish_head'&&!locked&&entries.some(item=>!item.voided)&&<p className="entry-history-hint">点击任意一篮可修改重量、鱼种或删除。</p>}
      <div className="weighing-entry-list">{entries.map(item=><button type="button" key={item.id}
        disabled={contextPending||entryMutationBusy||(busy&&!syncing)}
        className={`weighing-entry-row ${item.voided?'voided':''}`} onClick={()=>setEditing(item)}>
        <span>{item.sequenceNo?`第 ${item.sequenceNo} 篮`:'总重'}</span><strong>{item.displayNameSnapshot}</strong>
        <b>{formatWeightKg(item.weightGrams)} kg</b><small>{entryTime(item.recordedAtClient)}</small>
        <em>{item.voided?(productType==='fish_head'?'已删除':'已作废'):item.syncStatus==='synced'?'已同步':item.syncStatus==='failed'?'同步失败':'尚未同步'}</em>
        {productType==='fish_head'&&<span className="entry-row-action">{!locked&&!item.voided?'编辑':'查看'} ›</span>}
      </button>)}</div>
    </section>
    {session?.status==='weighing'&&activeContextEntries.length>0&&<button className="complete-weighing" type="button" disabled={busy||syncing||contextLoading} onClick={()=>setShowComplete(true)}>完成称重</button>}
    {session?.status==='completed'&&<div className="settlement-actions">{pending===0?<><Link className="primary-action settlement-link" to={productType==='fish_head'?`/fish-head-settlement/${session.id}`:`/fish-meal-settlement/${session.id}`}>查看{productType==='fish_head'?'鱼头':'鱼仔'}结单</Link>
      <Link className="page-link" to={`/weighing/${session.id}/review`}>修改称重（完成后 7 天内）</Link></>:<div className="notice"><p>{syncing?'正在同步称重，完成后即可查看结单。':'称重记录已保存在本机，同步成功后即可查看结单。'}</p>
      <button type="button" disabled={syncing} onClick={()=>void syncNow(session.id)}>重试同步</button></div>}</div>}
    {showComplete&&session&&<CompleteDialog session={session} pending={pending} close={()=>setShowComplete(false)} confirm={()=>void complete()}/>}
    {editing&&session&&<EntryDialog entry={editing} species={activeSpecies} locked={locked} close={()=>setEditing(null)}
      save={after=>updateEntry(editing,after)} voidEntry={reason=>queueVoid(editing,reason)}/>}
    {showCustomSpecies ? <CustomSpeciesDialog close={()=>setShowCustomSpecies(false)} save={addCustomSpecies}/> : null}
  </main>
}

function CustomSpeciesDialog({close,save}:{close:()=>void;save:(value:{displayName:string;save:boolean})=>Promise<void>}){
  const [displayName,setDisplayName]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false)
  useUnsavedChanges(!!displayName)
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
  const groups=new Map<string,{key:string;name:string;baskets:number;totalRecords:number;weightGrams:number}>()
  entries.filter(item=>!item.voided).forEach(item=>{
    const key=item.productType==='fish_head'?`species:${item.fishSpeciesCodeSnapshot}`:`meal:${item.fishMealQuality}`
    const current=groups.get(key)??{key,name:item.displayNameSnapshot,baskets:0,totalRecords:0,weightGrams:0}
    if(item.entryMode==='individual')current.baskets+=1
    else current.totalRecords+=1
    current.weightGrams+=item.weightGrams
    groups.set(key,current)
  })
  const fishMeal=entries[0]?.productType==='fish_meal'
  return <table><thead><tr><th>{fishMeal?'品质':'鱼名'}</th><th>总重量</th><th>{fishMeal?'篮子数 / 总重记录':'篮子数'}</th></tr></thead>
    <tbody>{[...groups.values()].map(item=><tr key={item.key}><th scope="row">{item.name}</th><td>{formatWeightKg(item.weightGrams)} kg</td>
      <td>{fishMeal?[
        item.baskets>0?`${item.baskets} 篮`:null,
        item.totalRecords>0?`总重 ${item.totalRecords} 条`:null,
      ].filter(Boolean).join(' / '):`${item.baskets} 篮`}</td></tr>)}</tbody></table>
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
  useUnsavedForm({ weight, speciesId, quality, reason })
  const [error,setError]=useState('')
  const [busy,setBusy]=useState(false)
  const actionLock=useRef(false)
  const fishHead=entry.productType==='fish_head',readOnly=locked||entry.voided
  const basketLabel=entry.sequenceNo?`第 ${entry.sequenceNo} 篮`:'总重记录'
  const title=fishHead?`${readOnly?'查看':'编辑'}${basketLabel}`:'查看记录'
  async function submit(event:FormEvent){event.preventDefault()
    if(readOnly||actionLock.current)return
    actionLock.current=true;setBusy(true);setError('')
    try{
      const grams=kgInputToGrams(weight,entry.entryMode),selected=species.find(item=>item.id===speciesId)
      const rebuilt=buildWeighingEntry({id:entry.id,clientEntryId:entry.clientEntryId,sessionId:entry.sessionId,
        productType:entry.productType,fishSpeciesId:entry.productType==='fish_head'?speciesId:null,
        fishSpecies:entry.productType==='fish_head'?selected:null,fishMealQuality:entry.productType==='fish_meal'?quality:null,
        entryMode:entry.entryMode,sequenceNo:entry.sequenceNo,weightGrams:grams,
        unitPriceCentsPerKg:entry.productType==='fish_meal'?entry.unitPriceCentsPerKg:undefined,remark:entry.remark,
        receiptNoSnapshot:entry.receiptNoSnapshot,
        weighingDate:entry.weighingDate,monthKey:entry.monthKey,vesselId:entry.vesselId,vesselCodeSnapshot:entry.vesselCodeSnapshot,
        recordedAtClient:entry.recordedAtClient,recordedAt:entry.recordedAt,recordedBy:entry.recordedBy})
      await save({...rebuilt,revision:entry.revision+1,syncStatus:'syncing'})
    }catch(problem){setError(problem instanceof Error?problem.message:'修改未保存，请重试。')}
    finally{actionLock.current=false;setBusy(false)}
  }
  async function remove(){
    if(readOnly||actionLock.current)return
    if(fishHead&&!window.confirm(`删除${basketLabel}？\n${entry.displayNameSnapshot} · ${formatWeightKg(entry.weightGrams)} kg\n记录会保留在系统审计中。`))return
    actionLock.current=true;setBusy(true);setError('')
    try{await voidEntry(reason.trim()||'错误记录')}
    catch(problem){setError(problem instanceof Error?problem.message:'删除未保存，请重试。')}
    finally{actionLock.current=false;setBusy(false)}
  }
  return <div className="dialog-backdrop"><section className={`form-dialog ${fishHead?'fish-head-entry-dialog':''}`} role="dialog" aria-modal="true" aria-labelledby="entry-dialog-title">
    {fishHead?<header className="entry-dialog-heading"><h2 id="entry-dialog-title">{title}</h2><button type="button" disabled={busy} onClick={close}>关闭</button></header>:<h2 id="entry-dialog-title">查看记录</h2>}
    {fishHead&&<p className="entry-current">{entry.displayNameSnapshot} · {formatWeightKg(entry.weightGrams)} kg</p>}
    <p className="entry-meta">{fishHead&&<>记录时间：{entryTime(entry.recordedAtClient)} · </>}修订版本：{entry.revision}{fishHead&&` · ${entry.syncStatus==='synced'?'已同步':'已保存在本机，等待同步'}`}{entry.voided&&` · 已${fishHead?'删除':'作废'}：${entry.voidReason}`}</p>
    <form className="master-form" onSubmit={submit}>
      {entry.productType==='fish_head'?<fieldset><legend>鱼名</legend><div className="species-grid">
        {species.map(item=><button type="button" key={item.id} aria-pressed={speciesId===item.id} className={speciesId===item.id?'selected':''} disabled={readOnly||busy} onClick={()=>setSpeciesId(item.id)}>{item.displayName}</button>)}</div></fieldset>:
        <label>鱼仔品质<select value={quality} disabled={readOnly||busy} onChange={event=>setQuality(event.target.value as FishMealQuality)}>
          <option value="bucket">桶鱼仔</option><option value="bag">包鱼仔</option></select></label>}
      <label className="entry-weight">重量（kg）<input inputMode="decimal" enterKeyHint="done" value={weight} disabled={readOnly||busy} onChange={event=>setWeight(event.target.value)}/></label>
      {!readOnly&&<button className="primary-action" disabled={busy}>{busy?'正在保存…':'保存修改'}</button>}
    </form>
    {!readOnly&&<div className="void-entry-panel"><label>{fishHead?'删除原因（选填）':'作废原因'}<input maxLength={100} value={reason} disabled={busy} onChange={event=>setReason(event.target.value)}/></label>
      {fishHead&&<small>记录会保留在系统审计中。</small>}
      <button type="button" className="danger-action" disabled={busy} onClick={()=>void remove()}>{fishHead?'删除此篮':'作废'}</button></div>}
    {error&&<p className="error" role="alert">{error}</p>}
    {!fishHead&&<button type="button" disabled={busy} onClick={close}>关闭</button>}
  </section></div>
}
