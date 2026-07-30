import { useEffect,useState,type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { crewWageRateForTemplate,type VesselWageTemplate } from '../lib/vesselTrips'
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
      {(['captain','crew'] as const).map(role=>crewWageRateForTemplate(item,role)).map(rate=><p key={rate.role}>
        {rate.role==='captain'?'Captain':'4 crew'}: {rate.role==='crew'&&'each '}
        RM {(rate.dayRateCents/100).toFixed(2)}/day · RM {(rate.nightRateCents/100).toFixed(2)}/night
      </p>)}
      <button onClick={()=>setEditing(item)}>Edit Rates</button>
    </article>)}</div>
    {editing&&<TemplateDialog item={editing} close={()=>setEditing(null)} save={async next=>{const saved=await saver(next)
      setItems(current=>[...(current??[]).filter(item=>item.vesselCode!==saved.vesselCode),saved].sort((a,b)=>a.vesselCode.localeCompare(b.vesselCode)));setEditing(null)}}/>}
  </main>
}

function TemplateDialog({item,save,close}:{item:VesselWageTemplate;save:(value:VesselWageTemplate)=>Promise<void>;close:()=>void}){
  const captain=crewWageRateForTemplate(item,'captain'),crew=crewWageRateForTemplate(item,'crew')
  const [name,setName]=useState(item.name)
  const [captainDay,setCaptainDay]=useState((captain.dayRateCents/100).toFixed(2))
  const [captainNight,setCaptainNight]=useState((captain.nightRateCents/100).toFixed(2))
  const [crewDay,setCrewDay]=useState((crew.dayRateCents/100).toFixed(2))
  const [crewNight,setCrewNight]=useState((crew.nightRateCents/100).toFixed(2))
  const [headcount,setHeadcount]=useState(String(crew.headcount))
  const [error,setError]=useState(''),[busy,setBusy]=useState(false)
  async function submit(event:FormEvent){event.preventDefault();setBusy(true);setError('')
    try{await save({...item,name,captainDayRateCents:Math.round(Number(captainDay)*100),
      captainNightRateCents:Math.round(Number(captainNight)*100),crewDayRateCents:Math.round(Number(crewDay)*100),
      crewNightRateCents:Math.round(Number(crewNight)*100),crewHeadcount:Number(headcount)})}
    catch(problem){setError(problem instanceof Error?problem.message:'Template was not saved.');setBusy(false)}}
  return <div className="dialog-backdrop"><section className="form-dialog" role="dialog" aria-modal="true"><h2>Edit {item.vesselCode} Wage Template</h2>
    <form className="master-form" onSubmit={submit}><label>Template name<input value={name} onChange={e=>setName(e.target.value)}/></label>
      <label>Captain day rate (RM)<input inputMode="decimal" value={captainDay} onChange={e=>setCaptainDay(e.target.value)}/></label>
      <label>Captain night rate (RM)<input inputMode="decimal" value={captainNight} onChange={e=>setCaptainNight(e.target.value)}/></label>
      <label>Crew headcount<input type="number" min="1" value={headcount} onChange={e=>setHeadcount(e.target.value)}/></label>
      <label>Each crew day rate (RM)<input inputMode="decimal" value={crewDay} onChange={e=>setCrewDay(e.target.value)}/></label>
      <label>Each crew night rate (RM)<input inputMode="decimal" value={crewNight} onChange={e=>setCrewNight(e.target.value)}/></label>
      {error&&<p className="error" role="alert">{error}</p>}<button className="primary-action" disabled={busy}>{busy?'Saving…':'Save Template'}</button>
      <button type="button" onClick={close} disabled={busy}>Cancel</button></form></section></div>
}
