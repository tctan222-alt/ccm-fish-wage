import { useEffect,useState,type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import type { VesselWageTemplate } from '../lib/vesselTrips'
import { loadVesselWageTemplates,saveVesselWageTemplate } from '../services/vesselTrips'

export function VesselWageTemplatesPage({loader=loadVesselWageTemplates,saver=saveVesselWageTemplate}:{
  loader?:()=>Promise<VesselWageTemplate[]>;saver?:(value:VesselWageTemplate)=>Promise<VesselWageTemplate>
}){
  const [items,setItems]=useState<VesselWageTemplate[]|null>(null),[error,setError]=useState(''),[editing,setEditing]=useState<VesselWageTemplate|null>(null)
  useEffect(()=>{void loader().then(setItems).catch(()=>{setItems([]);setError('Wage templates could not be loaded.')})},[loader])
  return <main><header><p className="eyebrow">CCM Fishery</p><h1>Vessel Wage Templates</h1>
    <Link className="page-link" to="/vessel-trips">← Vessel Trips</Link></header>
    <p className="notice">Daily work is stored as whole half-day units. Template rates are copied into each crew settlement so history never changes.</p>
    {error&&<p className="error" role="alert">{error}</p>}
    <div className="master-card-list">{items?.map(item=><article className="master-card" key={item.id}>
      <div className="master-card-heading"><div><small>Vessel {item.vesselCode}</small><h2>{item.name}</h2></div>
        <span className={`record-status ${item.active?'active':'inactive'}`}>{item.active?'Active':'Inactive'}</span></div>
      <p>Day RM {(item.dayRateCents/100).toFixed(2)} · Night RM {(item.nightRateCents/100).toFixed(2)}</p>
      <button onClick={()=>setEditing(item)}>Edit Rates</button>
    </article>)}</div>
    {editing&&<TemplateDialog item={editing} close={()=>setEditing(null)} save={async next=>{const saved=await saver(next)
      setItems(current=>[...(current??[]).filter(item=>item.vesselCode!==saved.vesselCode),saved].sort((a,b)=>a.vesselCode.localeCompare(b.vesselCode)));setEditing(null)}}/>}
  </main>
}

function TemplateDialog({item,save,close}:{item:VesselWageTemplate;save:(value:VesselWageTemplate)=>Promise<void>;close:()=>void}){
  const [name,setName]=useState(item.name),[day,setDay]=useState((item.dayRateCents/100).toFixed(2)),[night,setNight]=useState((item.nightRateCents/100).toFixed(2))
  const [error,setError]=useState(''),[busy,setBusy]=useState(false)
  async function submit(event:FormEvent){event.preventDefault();setBusy(true);setError('')
    try{await save({...item,name,dayRateCents:Math.round(Number(day)*100),nightRateCents:Math.round(Number(night)*100)})}
    catch(problem){setError(problem instanceof Error?problem.message:'Template was not saved.');setBusy(false)}}
  return <div className="dialog-backdrop"><section className="form-dialog" role="dialog" aria-modal="true"><h2>Edit {item.vesselCode} Wage Template</h2>
    <form className="master-form" onSubmit={submit}><label>Template name<input value={name} onChange={e=>setName(e.target.value)}/></label>
      <label>Day rate (RM)<input inputMode="decimal" value={day} onChange={e=>setDay(e.target.value)}/></label>
      <label>Night rate (RM)<input inputMode="decimal" value={night} onChange={e=>setNight(e.target.value)}/></label>
      {error&&<p className="error" role="alert">{error}</p>}<button className="primary-action" disabled={busy}>{busy?'Saving…':'Save Template'}</button>
      <button type="button" onClick={close} disabled={busy}>Cancel</button></form></section></div>
}
