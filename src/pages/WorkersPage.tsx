import { useEffect,useMemo,useRef,useState,type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { createWorker,loadWorkers,setWorkerActive } from '../services/workers'
import type { Worker } from '../types'

export function WorkersPage(){
  const [workers,setWorkers]=useState<Worker[]|null>(null)
  const [name,setName]=useState('')
  const [saving,setSaving]=useState(false)
  const [busyId,setBusyId]=useState('')
  const [message,setMessage]=useState('')
  const [error,setError]=useState('')
  const addLock=useRef(false)

  useEffect(()=>{
    loadWorkers()
      .then(setWorkers)
      .catch(()=>{setWorkers([]);setError('Workers could not be loaded. Check your connection and try again.')})
  },[])

  const nextOrder=useMemo(
    ()=>workers?workers.reduce((highest,worker)=>Math.max(highest,worker.order),-1)+1:0,
    [workers],
  )

  async function submit(event:FormEvent){
    event.preventDefault()
    if(addLock.current)return

    const cleanName=name.trim()
    if(cleanName.length===0){setError('Enter the worker name.');return}
    if(cleanName.length>100){setError('Worker name must be 100 characters or fewer.');return}
    if(workers?.some(worker=>worker.name.trim().toLocaleLowerCase()===cleanName.toLocaleLowerCase())){
      setError('This worker already exists.')
      return
    }

    addLock.current=true
    setSaving(true)
    setError('')
    setMessage('')
    try{
      const worker=await createWorker(cleanName,nextOrder)
      setWorkers(current=>[...(current??[]),worker].sort((a,b)=>a.order-b.order||a.name.localeCompare(b.name)))
      setName('')
      setMessage(`${worker.name} added and ready for wage entry.`)
    }catch{
      setError('Worker was not added. Check your connection and try again.')
    }finally{
      addLock.current=false
      setSaving(false)
    }
  }

  async function toggle(worker:Worker){
    if(busyId)return
    setBusyId(worker.id)
    setError('')
    setMessage('')
    try{
      await setWorkerActive(worker.id,!worker.active)
      setWorkers(current=>current?.map(item=>item.id===worker.id?{...item,active:!item.active}:item)??[])
      setMessage(`${worker.name} is now ${worker.active?'inactive':'active'}.`)
    }catch{
      setError('Worker status was not changed. Check your connection and try again.')
    }finally{
      setBusyId('')
    }
  }

  return <main>
    <header>
      <p className="eyebrow">CCM Fishery</p>
      <h1>Workers</h1>
      <Link className="page-link" to="/">← Back to wage entry</Link>
    </header>

    <section>
      <h2>Add worker</h2>
      <form className="worker-form" onSubmit={submit}>
        <label>
          Worker name
          <input
            autoComplete="off"
            maxLength={100}
            placeholder="Enter worker name"
            value={name}
            onChange={event=>setName(event.target.value)}
          />
        </label>
        <button className="primary-action" type="submit" disabled={saving}>
          {saving?'Adding…':'Add worker'}
        </button>
      </form>
    </section>

    {message&&<p className="success" role="status" aria-live="polite">✓ {message}</p>}
    {error&&<p className="error" role="alert">{error}</p>}

    <section>
      <h2>Worker list</h2>
      {workers===null?<p>Loading workers…</p>:workers.length===0?<p className="notice">No workers yet. Add the first worker above.</p>:
        <div className="worker-list">
          {workers.map(worker=><div className="worker-row" key={worker.id}>
            <div>
              <strong>{worker.name}</strong>
              <small>{worker.active?'Active — available for wage entry':'Inactive — hidden from wage entry'}</small>
            </div>
            <button
              className={worker.active?'deactivate-action':'activate-action'}
              type="button"
              disabled={busyId===worker.id}
              onClick={()=>void toggle(worker)}
            >
              {busyId===worker.id?'Saving…':worker.active?'Deactivate':'Activate'}
            </button>
          </div>)}
        </div>
      }
    </section>
  </main>
}