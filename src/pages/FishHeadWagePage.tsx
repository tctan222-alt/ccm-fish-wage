import { useEffect,useRef,useState } from 'react'
import { Link } from 'react-router-dom'
import { NumericKeypad } from '../components/NumericKeypad'
import { FIXED_RATE_CENTS,malaysiaDateKey,money,parseRateCents,validWeight,wageCents } from '../lib/wage'
import { loadActiveWorkers } from '../services/workers'
import { saveWageEntry } from '../services/wages'
import type { WageEntry,Worker } from '../types'

export interface PageProps { workerLoader?:()=>Promise<Worker[]>; saver?:(entry:WageEntry)=>Promise<void>; now?:()=>number }
export function FishHeadWagePage({workerLoader=loadActiveWorkers,saver=saveWageEntry,now=Date.now}:PageProps){
 const [workers,setWorkers]=useState<Worker[]|null>(null),[worker,setWorker]=useState<Worker|null>(null)
 const [rate,setRate]=useState<number|null>(12),[custom,setCustom]=useState(''),[weight,setWeight]=useState('')
 const [saving,setSaving]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState(''),[duplicate,setDuplicate]=useState(false)
 const last=useRef<{workerId:string;weight:number;rate:number;at:number}|null>(null), lock=useRef(false)
 useEffect(()=>{workerLoader().then(setWorkers).catch(()=>{setWorkers([]);setError('Workers could not be loaded. Please try again.')})},[workerLoader])
 const selectedRate=rate??parseRateCents(custom), weightOk=validWeight(weight), wage=selectedRate&&weightOk?wageCents(Number(weight),selectedRate):0
 async function confirm(force=false){
   if(lock.current||!worker||!selectedRate||!weightOk)return
   const timestamp=now(), previous=last.current
   if(!force&&previous&&previous.workerId===worker.id&&previous.weight===Number(weight)&&previous.rate===selectedRate&&timestamp-previous.at<5000){setDuplicate(true);return}
   lock.current=true;setSaving(true);setError('');setDuplicate(false)
   const entry:WageEntry={dateKey:malaysiaDateKey(new Date(timestamp)),workerId:worker.id,workerName:worker.name,weightKg:Number(weight),rateRm:money(selectedRate),wageRm:money(wage),createdBy:null,deleted:false}
   try{await saver(entry);last.current={workerId:worker.id,weight:Number(weight),rate:selectedRate,at:timestamp};setMessage(`Saved: ${worker.name}, ${weight}kg × RM${money(selectedRate)} = RM${money(wage)}`);setWeight('');navigator.vibrate?.(40)}catch{setError('Entry was not saved. Check your connection and try again.')}finally{lock.current=false;setSaving(false)}
 }
 return <main><header><p className="eyebrow">CCM Fishery</p><h1>Fish Head Wage</h1></header>
  <section><h2>1. Worker</h2>{workers===null?<p>Loading workers…</p>:workers.length===0?<p className="notice">No active workers. Add or activate one below.</p>:<div className="workers">{workers.map(w=><button className={worker?.id===w.id?'selected':''} aria-pressed={worker?.id===w.id} onClick={()=>setWorker(w)} key={w.id}>{w.name}</button>)}</div>}<Link className="manage-link" to="/workers">Add / manage workers</Link></section>
  <section><h2>2. Rate</h2><div className="rates">{FIXED_RATE_CENTS.map(r=><button className={rate===r?'selected':''} aria-pressed={rate===r} onClick={()=>setRate(r)} key={r}>RM{money(r)}</button>)}<button className={rate===null?'selected':''} aria-pressed={rate===null} onClick={()=>setRate(null)}>Custom</button></div>{rate===null&&<label className="custom">Custom rate (RM)<input inputMode="decimal" value={custom} onChange={e=>setCustom(e.target.value)} aria-invalid={custom!==''&&!parseRateCents(custom)}/><small>RM0.01–RM9.99, maximum 2 decimal places</small></label>}</section>
  <section><h2>3. Basket weight</h2><output className="weight" role="group" aria-label="Current basket weight">{weight||'0'} <small>kg</small></output><NumericKeypad value={weight} onChange={setWeight}/></section>
  <section className="total"><span>Calculated wage</span><strong>RM{money(wage)}</strong></section>
  {duplicate&&<div className="warning" role="alert"><strong>Possible duplicate entry.</strong><span>Same worker, weight and rate were just saved.</span><button onClick={()=>confirm(true)}>Save again</button><button className="secondary" onClick={()=>setDuplicate(false)}>Cancel</button></div>}
  {message&&<p className="success" role="status" aria-live="polite">✓ {message}</p>}{error&&<p className="error" role="alert">{error}</p>}
  <button className="confirm" disabled={saving||!worker||!selectedRate||!weightOk} onClick={()=>confirm()}>{saving?'Saving…':'Confirm entry'}</button>
 </main>
}