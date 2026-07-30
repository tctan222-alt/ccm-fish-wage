import { useEffect,useState,type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import type { FishSpeciesRecord } from '../lib/weighing'
import { initializeDefaultFishSpecies,loadFishSpecies,saveFishSpecies } from '../services/weighing'

export function FishSpeciesPage({loader=loadFishSpecies,initializer=initializeDefaultFishSpecies,saver=saveFishSpecies}:{
  loader?:()=>Promise<FishSpeciesRecord[]>
  initializer?:(items:FishSpeciesRecord[])=>Promise<FishSpeciesRecord[]>
  saver?:(item:FishSpeciesRecord)=>Promise<FishSpeciesRecord>
}){
  const [items,setItems]=useState<FishSpeciesRecord[]|null>(null)
  const [editing,setEditing]=useState<FishSpeciesRecord|null>(null)
  const [busy,setBusy]=useState(false),[error,setError]=useState('')
  useEffect(()=>{void loader().then(setItems).catch(()=>{setItems([]);setError('无法载入鱼名资料。')})},[loader])
  async function initialize(){if(!items)return;setBusy(true);setError('')
    try{setItems(await initializer(items))}catch{setError('默认鱼名建立失败，请重试。')}finally{setBusy(false)}}
  async function toggle(item:FishSpeciesRecord){
    setBusy(true);try{const saved=await saver({...item,active:!item.active});setItems(current=>current?.map(row=>row.id===saved.id?saved:row)??[])}
    catch(problem){setError(problem instanceof Error?problem.message:'鱼名状态修改失败。')}finally{setBusy(false)}
  }
  return <main><header><p className="eyebrow">CCM Fishery</p><h1>鱼名管理</h1><Link className="page-link" to="/master-data">← 主资料中心</Link></header>
    {error&&<p className="error" role="alert">{error}</p>}
    {items===null?<p className="notice">正在载入鱼名…</p>:items.length===0?<section>
      <h2>尚未建立鱼名</h2><p>建立前不会自动写入生产资料。请由管理员明确确认。</p>
      <button className="primary-action" disabled={busy} onClick={()=>void initialize()}>建立 CCM 默认鱼名</button>
    </section>:<div className="master-card-list">{items.sort((a,b)=>a.order-b.order).map(item=><article className="master-card" key={item.id}>
      <div className="master-card-heading"><div><small>{item.speciesCode}</small><h2>{item.displayName}</h2></div>
        <span className={`record-status ${item.active?'active':'inactive'}`}>{item.active?'启用':'停用'}</span></div>
      <p>顺序：{item.order}{item.notes&&` · ${item.notes}`}</p>
      <div className="master-actions"><button onClick={()=>setEditing(item)}>修改</button>
        <button disabled={busy} className={item.active?'deactivate-action':'activate-action'} onClick={()=>void toggle(item)}>{item.active?'停用':'重新启用'}</button></div>
    </article>)}</div>}
    {editing&&<FishSpeciesDialog item={editing} close={()=>setEditing(null)} save={async next=>{const saved=await saver(next)
      setItems(current=>current?.map(item=>item.id===saved.id?saved:item)??[]);setEditing(null)}}/>}
  </main>
}

function FishSpeciesDialog({item,close,save}:{item:FishSpeciesRecord;close:()=>void;save:(item:FishSpeciesRecord)=>Promise<void>}){
  const [name,setName]=useState(item.displayName),[order,setOrder]=useState(String(item.order)),[notes,setNotes]=useState(item.notes)
  const [error,setError]=useState(''),[busy,setBusy]=useState(false)
  async function submit(event:FormEvent){event.preventDefault();setBusy(true)
    try{await save({...item,displayName:name,order:Number(order),notes})}
    catch(problem){setError(problem instanceof Error?problem.message:'鱼名保存失败。');setBusy(false)}}
  return <div className="dialog-backdrop"><section className="form-dialog" role="dialog" aria-modal="true"><h2>修改鱼名</h2>
    <form className="master-form" onSubmit={submit}><label>内部代码<input value={item.speciesCode} disabled/></label>
      <label>中文鱼名<input value={name} onChange={event=>setName(event.target.value)}/></label>
      <label>显示顺序<input type="number" min="1" value={order} onChange={event=>setOrder(event.target.value)}/></label>
      <label>备注<textarea value={notes} onChange={event=>setNotes(event.target.value)}/></label>
      {error&&<p className="error" role="alert">{error}</p>}<button className="primary-action" disabled={busy}>保存</button>
      <button type="button" disabled={busy} onClick={close}>取消</button></form>
  </section></div>
}
