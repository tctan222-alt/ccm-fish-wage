import { useEffect,useMemo,useState } from 'react'
import { Link,useParams } from 'react-router-dom'
import type { BusinessPartner } from '../lib/masterData'
import { rmInputToCentsPerKg } from '../lib/purchasing'
import {
  buildReceiptLinesFromWeighing,formatMalaysiaDate,formatWeightKg,groupWeighingEntries,
  type WeighingEntry,type WeighingSession,
} from '../lib/weighing'
import { loadActiveSuppliers } from '../services/businessPartners'
import {
  loadWeighingBundle,processWeighingSessionToReceipt,reopenWeighingSession,voidWeighingSession,
  type WeighingBundle,
} from '../services/weighing'

type Processor=typeof processWeighingSessionToReceipt

export function WeighingReviewPage({
  bundleLoader=loadWeighingBundle,supplierLoader=loadActiveSuppliers,processor=processWeighingSessionToReceipt,
  reopener=reopenWeighingSession,voider=voidWeighingSession,
}:{
  bundleLoader?:(id:string)=>Promise<WeighingBundle>
  supplierLoader?:()=>Promise<BusinessPartner[]>
  processor?:Processor
  reopener?:(id:string,reason:string)=>Promise<WeighingSession>
  voider?:(id:string,reason:string)=>Promise<WeighingSession>
}){
  const {sessionId=''}=useParams()
  const [bundle,setBundle]=useState<WeighingBundle|null>(null),[suppliers,setSuppliers]=useState<BusinessPartner[]>([])
  const [supplierId,setSupplierId]=useState(''),[prices,setPrices]=useState<Record<string,string>>({})
  const [error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false)
  const [created,setCreated]=useState<{receiptId:string;receiptCode:string}|null>(null)
  useEffect(()=>{Promise.all([bundleLoader(sessionId),supplierLoader()]).then(([loaded,partners])=>{
    setBundle(loaded);setSuppliers(partners)
  }).catch(()=>setError('无法载入现场称重单。'))},[sessionId,bundleLoader,supplierLoader])
  const groups=useMemo(()=>groupWeighingEntries(bundle?.entries??[]),[bundle])
  if(!bundle)return <main><p className={error?'error':'notice'} role={error?'alert':undefined}>{error||'正在载入现场称重单…'}</p></main>
  const {session,entries}=bundle
  async function process(){
    const supplier=suppliers.find(item=>item.id===supplierId)
    if(!supplier){setError('请选择供应商。');return}
    try{
      const cents=Object.fromEntries(groups.filter(group=>group.unitPriceCentsPerKg===null)
        .map(group=>[group.key,rmInputToCentsPerKg(prices[group.key]??'')]))
      setBusy(true);setError('')
      const result=await processor({sessionId:session.id,supplier,lines:buildReceiptLinesFromWeighing(session.id,entries,cents)})
      setCreated(result);setBundle(current=>current?{...current,session:{...current.session,status:'processed',
        processedReceiptId:result.receiptId,processedReceiptCode:result.receiptCode}}:current)
      setMessage(`已生成草稿采购单 ${result.receiptCode}`)
    }catch(problem){setError(problem instanceof Error?problem.message:'无法生成草稿采购单。')}
    finally{setBusy(false)}
  }
  async function changeStatus(kind:'reopen'|'void'){
    const reason=window.prompt(kind==='reopen'?'请输入重开原因：':'请输入作废原因：')?.trim()
    if(!reason)return
    try{
      setBusy(true);setError('')
      const next=kind==='reopen'?await reopener(session.id,reason):await voider(session.id,reason)
      setBundle(current=>current?{...current,session:next}:current)
      setMessage(kind==='reopen'?'现场单已重开。':'现场单已作废。')
    }catch(problem){setError(problem instanceof Error?problem.message:'操作失败。')}
    finally{setBusy(false)}
  }
  return <main className="weighing-review-page"><header><p className="eyebrow">CCM Fishery</p><h1>称重复核</h1>
    <Link className="page-link" to="/weighing">← 现场称重单</Link></header>
    <section className="weighing-review-heading"><div><small>现场单号</small><strong>{session.sessionCode}</strong></div>
      <div><small>船号与日期</small><strong>{session.vesselCodeSnapshot} · {formatMalaysiaDate(session.weighingDate)}</strong></div>
      <div><small>状态</small><strong>{statusName(session.status)}</strong></div>
      <div><small>总重量</small><strong>{formatWeightKg(session.totalWeightGrams)} kg</strong></div></section>
    {session.status==='processed'&&<p className="notice">已处理，原始称重记录继续永久保留。
      {session.processedReceiptId&&<Link to={`/purchases/${session.processedReceiptId}`}>{session.processedReceiptCode}</Link>}</p>}
    {error&&<p className="error" role="alert">{error}</p>}{message&&<p className="notice" role="status">{message}</p>}
    <section className="weighing-review-section" role="region" aria-label="分类汇总与单价"><h2>分类汇总与单价</h2>
      <div className="weighing-group-list">{groups.map(group=><article key={group.key} className="weighing-group-card">
        <div><strong>{group.displayName}</strong><span>{group.basketCount} 篮 · {formatWeightKg(group.weightGrams)} kg</span>
          <small>{group.entries.map(entry=>entry.entryMode==='individual'
            ?`第 ${entry.sequenceNo} 篮 ${formatWeightKg(entry.weightGrams)} kg`
            :`总重 ${formatWeightKg(entry.weightGrams)} kg${entry.remark?`（${entry.remark}）`:''}`).join(' · ')}</small></div>
        {session.status==='completed'&&(group.unitPriceCentsPerKg===null?<label>{group.displayName}单价（RM/kg）
          <input aria-label={`${group.displayName}单价（RM/kg）`} inputMode="decimal" value={prices[group.key]??''}
            onChange={event=>setPrices(current=>({...current,[group.key]:event.target.value}))}/></label>:<p>已保存单价：RM {(group.unitPriceCentsPerKg/100).toFixed(2)}/kg</p>)}
      </article>)}</div>
      {session.status==='completed'&&<div className="weighing-process-form"><label>供应商
        <select aria-label="Supplier" value={supplierId} onChange={event=>setSupplierId(event.target.value)}>
          <option value="">请选择</option>{suppliers.map(item=><option value={item.id} key={item.id}>{item.displayName}</option>)}</select></label>
        <button className="primary-action" type="button" disabled={busy||Boolean(created)} onClick={()=>void process()}>生成草稿采购单</button></div>}
      {created&&<Link className="page-link" to={`/purchases/${created.receiptId}`}>打开 {created.receiptCode}</Link>}
    </section>
    <section className="weighing-review-section" role="region" aria-label="原始称重记录"><h2>原始称重记录</h2>
      <p>逐篮、总重及作废记录均永久保留。</p><div className="weighing-review-entries">
        {[...entries].sort((a,b)=>(a.sequenceNo??Number.MAX_SAFE_INTEGER)-(b.sequenceNo??Number.MAX_SAFE_INTEGER)
          ||a.recordedAtClient.localeCompare(b.recordedAtClient)).map(item=><RawEntry key={item.id} entry={item}/>)}
      </div></section>
    <section className="weighing-review-section" role="region" aria-label="修改与作废历史"><h2>修改与作废历史</h2>
      <div className="weighing-action-list">{(bundle.actions??[]).map(action=><article key={action.id}>
        <strong>{actionName(action.type)}</strong><span>{action.entryId?`记录 ${action.entryId}`:'现场单'}</span>
        {action.reason&&<span>原因：{action.reason}</span>}
        <small>{compactSnapshot(action.beforeSnapshot)} → {compactSnapshot(action.afterSnapshot)}</small>
      </article>)}
      {(bundle.actions??[]).length===0&&<p className="notice">尚无修改或作废记录。</p>}</div>
    </section>
    {session.status==='completed'&&<section className="weighing-review-actions">
      <button type="button" disabled={busy} onClick={()=>void changeStatus('reopen')}>重开称重</button>
      <button className="danger-action" type="button" disabled={busy} onClick={()=>void changeStatus('void')}>作废现场单</button>
    </section>}
  </main>
}

function RawEntry({entry}:{entry:WeighingEntry}){
  return <article className={entry.voided?'voided':''}><div><strong>{entry.sequenceNo?`第 ${entry.sequenceNo} 篮`:'总重'}</strong>
    <span>{entry.displayNameSnapshot}</span>{entry.remark&&<small>{entry.remark}</small>}</div>
    <div><b>{formatWeightKg(entry.weightGrams)} kg</b>{entry.unitPriceCentsPerKg!=null&&<small>RM {(entry.unitPriceCentsPerKg/100).toFixed(2)}/kg · RM {((entry.amountCents??0)/100).toFixed(2)}</small>}<small>版本 {entry.revision}</small>
      {entry.voided&&<em>已作废{entry.voidReason?`：${entry.voidReason}`:''}</em>}</div></article>
}

function statusName(status:WeighingSession['status']){
  return {weighing:'称重中',completed:'已完成',processed:'已处理',voided:'已作废'}[status]
}

function actionName(type:string){
  return {create:'建立现场单',entry_create:'新增称重',entry_update:'修改称重',entry_void:'作废称重',
    complete:'完成称重',reopen:'重开称重',process:'生成采购单',session_void:'作废现场单',
    sync_conflict:'同步冲突'}[type]??type
}

function compactSnapshot(value:unknown){
  if(value==null)return '无'
  const text=JSON.stringify(value)
  return text.length>160?`${text.slice(0,157)}…`:text
}
