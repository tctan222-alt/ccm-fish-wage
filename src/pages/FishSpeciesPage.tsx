import { useEffect,useState,type FormEvent } from 'react'
import { useUnsavedForm } from '../components/dirtyState'
import { Link } from 'react-router-dom'
import type { FishSpeciesRecord } from '../lib/weighing'
import { initializeDefaultFishSpecies,loadFishSpecies,saveFishSpecies } from '../services/weighing'
import { fishHeadMasterBasePriceCents,fishHeadMasterPriceInputToCents,fishHeadMasterPriceInputValue } from '../lib/fishHeadMasterPrice'
import { previewFishHeadMasterImport,fishHeadMasterProposalKey } from '../lib/fishHeadMasterImport'
import { QL_METHOD_LABELS } from '../lib/qlPrices'
import './fishSpecies.css'

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
  return <main className="fish-species-master"><header><p className="eyebrow">CCM Fishery</p><h1>鱼头鱼名与基础默认价 Fish Head Master</h1><Link className="page-link" to="/master-data">← 主资料中心</Link></header>
    <p className="notice">基础默认价 Base default price (RM/kg)，不含船号加价。修改只影响之后的默认建议价，不改写已保存结单。</p>
    {error&&<p className="error" role="alert">{error}</p>}
    {items!==null&&!error&&<QlMasterPreview items={items}/>}
    {items===null?<p className="notice">正在载入鱼名…</p>:items.length===0?<section>
      <h2>尚未建立鱼名</h2><p>建立前不会自动写入生产资料。请由管理员明确确认。</p>
      <button className="primary-action" disabled={busy} onClick={()=>void initialize()}>建立 CCM 默认鱼名</button>
    </section>:<div className="master-card-list">{[...items].sort((a,b)=>a.order-b.order).map(item=><article className="master-card" id={`species-${item.id}`} key={item.id}>
      <div className="master-card-heading"><div><small>{item.speciesCode}</small><h2>{item.displayName}</h2></div>
        <span className={`record-status ${item.active?'active':'inactive'}`}>{item.active?'启用':'停用'}</span></div>
      <p>顺序：{item.order}{item.notes&&` · ${item.notes}`}</p>
      <p>基础默认价 Base default：{fishHeadMasterPriceInputValue(item)?`RM${fishHeadMasterPriceInputValue(item)}/kg`:'未设默认价 Not set'}</p>
      <div className="master-actions"><button onClick={()=>setEditing(item)}>修改鱼名 / 基础价 Edit</button>
        <button disabled={busy} className={item.active?'deactivate-action':'activate-action'} onClick={()=>void toggle(item)}>{item.active?'停用':'重新启用'}</button></div>
    </article>)}</div>}
    {editing&&<FishSpeciesDialog item={editing} close={()=>setEditing(null)} save={async next=>{const saved=await saver(next)
      setItems(current=>current?.map(item=>item.id===saved.id?saved:item)??[]);setEditing(null)}}/>}
  </main>
}

function money(cents:number|null){return cents===null?'未设默认价':`RM${(cents/100).toFixed(2)}`}

function QlMasterPreview({items}:{items:FishSpeciesRecord[]}){
  const preview=previewFishHeadMasterImport(items)
  return <details className="ql-master-preview"><summary>审阅 QL 36组新默认价 Preview（只读）</summary>
    <p className="notice">来源 {preview.sourceVersion} · 生效参考 {preview.sourceEffectiveDate}。此预览不会写入 Master；采用前须另行批准映射、冲突处理与实际变更。</p>
    <p><strong>安全匹配 {preview.matchedCount}</strong> · 拟修改基础价 {preview.changedCount} · 同价 {preview.unchangedCount} · 待新增 {preview.newCount} · <strong>冲突 {preview.conflictCount}</strong> · 保留未采用旧资料（含冲突） {preview.retainedLegacyCount}</p>
    <div className="ql-master-table-wrap"><table><caption>未来基础默认价对照（不含船号加价）</caption><thead><tr><th scope="col"># / 来源组</th><th scope="col">状态</th><th scope="col">现有 Master / 旧 RM/kg</th><th scope="col">拟议新 RM/kg</th></tr></thead><tbody>
      {preview.proposals.map(item=><tr key={fishHeadMasterProposalKey(item)} className={`ql-master-${item.status}`}>
        <td><strong>{item.source.sourceRow-3}. {item.source.label}</strong><small>{QL_METHOD_LABELS[item.source.method]} · 别名：{item.source.aliases.join('、')||'保留整组，不自动拆分'}</small></td>
        <td>{item.status==='matched'?'匹配':item.status==='new'?'新增':'冲突，阻止自动采用'}</td>
        <td>{item.matches.length?item.matches.map((match,index)=><small key={`${match.id}:${index}`}>{match.displayName} ({match.speciesCode} / ID: {match.id}) · {money(fishHeadMasterBasePriceCents(match))}{!match.active?' · 已停用':''}</small>):'无匹配记录'}{item.reason&&<small>{item.reason}</small>}</td>
        <td><strong>{money(item.source.priceCentsPerKg)}</strong>{item.status==='conflict'&&<small>映射未定，不能采用</small>}</td>
      </tr>)}</tbody></table></div>
    <p className="notice">丁温／目孔的拖网与底船、青兰的一般与底船必须保留不同上下文；加晒与加西保持不同来源拼写。表外旧鱼名不会删除。</p>
    <p className="notice">未来获准采用时，只影响新默认建议价；已保存结单、实际成交价与 978／5202 船号加价保持原样。Retail、Fish Meal 与 QL 客户价独立。</p>
  </details>
}

function FishSpeciesDialog({item,close,save}:{item:FishSpeciesRecord;close:()=>void;save:(item:FishSpeciesRecord)=>Promise<void>}){
  const [name,setName]=useState(item.displayName),[order,setOrder]=useState(String(item.order)),[notes,setNotes]=useState(item.notes)
  const [basePrice,setBasePrice]=useState(()=>fishHeadMasterPriceInputValue(item))
  useUnsavedForm({ name, order, notes, basePrice })
  const [error,setError]=useState(''),[busy,setBusy]=useState(false)
  async function submit(event:FormEvent){event.preventDefault();setBusy(true)
    try{await save({...item,displayName:name,order:Number(order),notes,basePriceCentsPerKg:fishHeadMasterPriceInputToCents(basePrice)})}
    catch(problem){setError(problem instanceof Error?problem.message:'鱼名保存失败。');setBusy(false)}}
  return <div className="dialog-backdrop"><section className="form-dialog" role="dialog" aria-modal="true"><h2>修改鱼名</h2>
    <form className="master-form" onSubmit={submit}><label>内部代码<input value={item.speciesCode} disabled/></label>
      <label>中文鱼名<input value={name} onChange={event=>setName(event.target.value)}/></label>
      <label>基础默认价 Base default (RM/kg)<input inputMode="decimal" type="text" value={basePrice} placeholder="未设默认价 Not set" onChange={event=>setBasePrice(event.target.value)}/></label>
      <p className="notice">留空表示未设默认价。此处不包含 978 / 5202 船号的 RM0.05/kg 加价，也不会改写历史结单价格。</p>
      <label>显示顺序<input type="number" min="1" value={order} onChange={event=>setOrder(event.target.value)}/></label>
      <label>备注<textarea value={notes} onChange={event=>setNotes(event.target.value)}/></label>
      {error&&<p className="error" role="alert">{error}</p>}<button className="primary-action" disabled={busy}>保存</button>
      <button type="button" disabled={busy} onClick={close}>取消</button></form>
  </section></div>
}
