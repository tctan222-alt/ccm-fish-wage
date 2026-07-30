import { useEffect,useMemo,useState } from 'react'
import { Link } from 'react-router-dom'
import { WorkerFormDialog } from '../components/WorkerFormDialog'
import { normalizeWorker,type WorkerInput } from '../lib/masterData'
import { createWorker,deactivateWorker,loadWorkers,reactivateWorker,updateWorker } from '../services/workers'
import type { Worker } from '../types'

interface Props {
  loader?:()=>Promise<Worker[]>;creator?:(input:WorkerInput,order:number)=>Promise<Worker>
  updater?:(worker:Worker,input:WorkerInput)=>Promise<Worker>;deactivator?:(worker:Worker)=>Promise<void>;reactivator?:(worker:Worker)=>Promise<void>
}
export function WorkersPage({loader=loadWorkers,creator=createWorker,updater=updateWorker,deactivator=deactivateWorker,reactivator=reactivateWorker}:Props){
  const [workers,setWorkers]=useState<Worker[]|null>(null);const [search,setSearch]=useState('');const [filter,setFilter]=useState<'all'|'active'|'inactive'>('all')
  const [editing,setEditing]=useState<Worker|null|undefined>(undefined);const [error,setError]=useState('')
  const [busyId,setBusyId]=useState('')
  useEffect(()=>{loader().then(items=>setWorkers(items.map(normalizeWorker))).catch(()=>{setWorkers([]);setError('Workers could not be loaded.')})},[loader])
  const visible=useMemo(()=>(workers??[]).filter(worker=>(filter==='all'||(filter==='active'&&worker.active)||(filter==='inactive'&&!worker.active))
    &&[worker.name,worker.workerCode,worker.phone,worker.department].join(' ').toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())),[workers,search,filter])
  const nextOrder=(workers??[]).reduce((highest,worker)=>Math.max(highest,worker.order),-1)+1
  async function toggle(worker:Worker){if(busyId)return;if(worker.active&&!window.confirm(`Deactivate ${worker.name}? Historical wage records will remain unchanged.`))return
    setBusyId(worker.id)
    try{if(worker.active)await deactivator(worker);else await reactivator(worker);setWorkers(current=>current?.map(item=>item.id===worker.id?{...item,active:!worker.active}:item)??[])}
    catch{setError('Worker status was not changed.')}finally{setBusyId('')}}
  function saveWorker(input:WorkerInput){
    const duplicate=(workers??[]).some(item=>item.id!==editing?.id&&item.name.trim().toLocaleLowerCase()===input.name.trim().toLocaleLowerCase())
    if(duplicate)return Promise.reject(new Error('This worker name already exists.'))
    return editing?updater(editing,input):creator(input,nextOrder)
  }
  return <main><header><p className="eyebrow">CCM Fishery</p><h1>Workers</h1><Link className="page-link" to="/master-data">← Master Data</Link></header>
    <button className="primary-action master-add" onClick={()=>setEditing(null)}>Add Worker</button>
    <section className="master-filters"><label>Search workers<input value={search} onChange={e=>setSearch(e.target.value)}/></label>
      <label>Worker filter<select value={filter} onChange={e=>setFilter(e.target.value as typeof filter)}><option value="all">All</option><option value="active">Active</option><option value="inactive">Inactive</option></select></label></section>
    {error&&<p className="error" role="alert">{error}</p>}
    {workers===null?<p className="notice">Loading workers…</p>:<div className="master-card-list">{visible.map(worker=><article className="master-card" key={worker.id}>
      <div className="master-card-heading"><div><small>{worker.workerCode||`ID: ${worker.id}`}</small><h2>{worker.name}</h2></div><span className={`record-status ${worker.active?'active':'inactive'}`}>{worker.active?'Active':'Inactive'}</span></div>
      <dl><div><dt>Department</dt><dd>{worker.department||'fish_head'}</dd></div><div><dt>Phone</dt><dd>{worker.phone||'—'}</dd></div><div><dt>Start</dt><dd>{worker.employmentStartDate||'—'}</dd></div><div><dt>End</dt><dd>{worker.employmentEndDate||'—'}</dd></div></dl>
      {worker.notes&&<p>{worker.notes}</p>}<div className="master-actions"><button disabled={busyId===worker.id} onClick={()=>setEditing(worker)}>Edit</button><button disabled={busyId===worker.id} aria-label={`${worker.active?'Deactivate':'Reactivate'} ${worker.name}`} className={worker.active?'danger-action':'activate-action'} onClick={()=>void toggle(worker)}>{busyId===worker.id?'Saving…':worker.active?'Deactivate':'Reactivate'}</button></div>
    </article>)}</div>}
    {editing!==undefined&&<WorkerFormDialog worker={editing} save={saveWorker}
      onDeactivate={async worker=>{await deactivator(worker);setWorkers(current=>current?.map(item=>item.id===worker.id?{...item,active:false}:item)??[])}}
      onReactivate={async worker=>{await reactivator(worker);setWorkers(current=>current?.map(item=>item.id===worker.id?{...item,active:true}:item)??[])}}
      onClose={()=>setEditing(undefined)} onSaved={result=>{setWorkers(current=>editing?current?.map(item=>item.id===result.id?result:item)??[]:[...(current??[]),result]);setEditing(undefined)}}/>}
  </main>
}
