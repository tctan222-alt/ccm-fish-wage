import { useEffect,useRef,useState } from 'react'
import { Link } from 'react-router-dom'
import { NumericKeypad } from '../components/NumericKeypad'
import { FIXED_RATE_CENTS,malaysiaDateKey,money,parseRateCents,validWeight,wageCents } from '../lib/wage'
import { loadActiveWorkers } from '../services/workers'
import { saveWageEntries } from '../services/wages'
import type { WageEntry,Worker } from '../types'

interface SessionEntry extends WageEntry {
  localId:string
  rateCents:number
  wageCents:number
  addedAt:number
}

export interface PageProps {
  workerLoader?:()=>Promise<Worker[]>
  batchSaver?:(entries:WageEntry[])=>Promise<void>
  now?:()=>number
}

export function FishHeadWagePage({
  workerLoader=loadActiveWorkers,
  batchSaver=saveWageEntries,
  now=Date.now,
}:PageProps){
  const [workers,setWorkers]=useState<Worker[]|null>(null)
  const [worker,setWorker]=useState<Worker|null>(null)
  const [rate,setRate]=useState<number|null>(12)
  const [custom,setCustom]=useState('')
  const [weight,setWeight]=useState('')
  const [entries,setEntries]=useState<SessionEntry[]>([])
  const [savingTotal,setSavingTotal]=useState(false)
  const [message,setMessage]=useState('')
  const [savedSummary,setSavedSummary]=useState('')
  const [error,setError]=useState('')
  const [duplicate,setDuplicate]=useState(false)

  const addLock=useRef(false)
  const saveLock=useRef(false)
  const last=useRef<{workerId:string;weight:number;rate:number;at:number}|null>(null)

  useEffect(()=>{
    workerLoader()
      .then(items=>setWorkers(items.filter(item=>item.active)))
      .catch(()=>{setWorkers([]);setError('Workers could not be loaded. Please try again.')})
  },[workerLoader])

  const selectedRate=rate??parseRateCents(custom)
  const weightOk=validWeight(weight)
  const currentWageCents=selectedRate&&weightOk?wageCents(Number(weight),selectedRate):0
  const totalWeight=entries.reduce((sum,entry)=>sum+entry.weightKg,0)
  const totalWageCents=entries.reduce((sum,entry)=>sum+entry.wageCents,0)

  function chooseWorker(nextWorker:Worker){
    if(entries.length>0&&worker?.id!==nextWorker.id)return
    setWorker(nextWorker)
    setWeight('')
    setMessage('')
    setSavedSummary('')
    setError('')
    setDuplicate(false)
    last.current=null
  }

  function addEntry(force=false){
    if(addLock.current||!worker||!selectedRate||!weightOk)return

    const timestamp=now()
    const previous=last.current
    const weightNumber=Number(weight)

    if(
      !force&&previous&&
      previous.workerId===worker.id&&
      previous.weight===weightNumber&&
      previous.rate===selectedRate&&
      timestamp-previous.at<5000
    ){
      setDuplicate(true)
      return
    }

    addLock.current=true
    setError('')
    setDuplicate(false)
    setSavedSummary('')

    const entry:SessionEntry={
      localId:`${timestamp}-${entries.length}-${worker.id}`,
      dateKey:malaysiaDateKey(new Date(timestamp)),
      workerId:worker.id,
      workerName:worker.name,
      weightKg:weightNumber,
      rateRm:money(selectedRate),
      wageRm:money(currentWageCents),
      createdBy:null,
      deleted:false,
      rateCents:selectedRate,
      wageCents:currentWageCents,
      addedAt:timestamp,
    }

    setEntries(current=>[...current,entry])
    last.current={workerId:worker.id,weight:weightNumber,rate:selectedRate,at:timestamp}
    setMessage(`Added: ${worker.name}, ${weightNumber}kg × RM${money(selectedRate)} = RM${money(currentWageCents)}`)
    setWeight('')
    navigator.vibrate?.(40)
    addLock.current=false
  }

  function removeEntry(localId:string){
    setEntries(current=>current.filter(entry=>entry.localId!==localId))
    setMessage('Entry removed from the current worker list.')
    setDuplicate(false)
    last.current=null
  }

  function clearCurrentWorker(){
    if(entries.length===0)return
    const approved=window.confirm(`Clear all ${entries.length} entries for ${worker?.name??'this worker'}?`)
    if(!approved)return
    setEntries([])
    setWeight('')
    setMessage('Current worker list cleared.')
    setDuplicate(false)
    last.current=null
  }

  async function saveWorkerTotal(){
    if(saveLock.current||!worker||entries.length===0)return

    saveLock.current=true
    setSavingTotal(true)
    setError('')
    setMessage('')
    setDuplicate(false)

    const payload:WageEntry[]=entries.map(entry=>({
      dateKey:entry.dateKey,
      workerId:entry.workerId,
      workerName:entry.workerName,
      weightKg:entry.weightKg,
      rateRm:entry.rateRm,
      wageRm:entry.wageRm,
      createdBy:entry.createdBy,
      deleted:entry.deleted,
    }))
    const summary={
      workerName:worker.name,
      basketCount:entries.length,
      totalWeight,
      totalWageCents,
    }

    try{
      await batchSaver(payload)
      setSavedSummary(
        `Saved ${summary.workerName}: ${summary.basketCount} basket${summary.basketCount===1?'':'s'}, `+
        `${summary.totalWeight}kg, RM${money(summary.totalWageCents)}`,
      )
      setEntries([])
      setWorker(null)
      setWeight('')
      last.current=null
      navigator.vibrate?.([60,40,60])
    }catch{
      setError('Worker total was not saved. The list is still here. Check your connection and try again.')
    }finally{
      saveLock.current=false
      setSavingTotal(false)
    }
  }

  return <main>
    <header>
      <p className="eyebrow">CCM Fishery</p>
      <h1>Fish Head Wage</h1>
    </header>

    <nav className="summary-nav" aria-label="Wage summaries">
      <Link className="summary-link" to="/today">Today / Daily Summary</Link>
      <Link className="summary-link monthly" to="/monthly">Monthly Summary</Link>
      <Link className="summary-link master-data-link" to="/master-data">Master Data</Link>
    </nav>

    {savedSummary&&<p className="success saved-summary" role="status" aria-live="polite">✓ {savedSummary}</p>}

    <section>
      <h2>1. Worker</h2>
      {workers===null?<p>Loading workers…</p>:workers.length===0?
        <p className="notice">No active workers. Add or activate one below.</p>:
        <div className="workers">
          {workers.map(item=><button
            className={worker?.id===item.id?'selected':''}
            aria-pressed={worker?.id===item.id}
            disabled={entries.length>0&&worker?.id!==item.id}
            onClick={()=>chooseWorker(item)}
            key={item.id}
          >
            {item.name}
          </button>)}
        </div>
      }
      {entries.length>0&&worker&&
        <p className="session-lock">Finish or clear <strong>{worker.name}</strong>'s list before selecting another worker.</p>
      }
      <Link className="manage-link" to="/workers">Add / manage workers</Link>
    </section>

    <section>
      <h2>2. Rate</h2>
      <div className="rates">
        {FIXED_RATE_CENTS.map(item=><button
          className={rate===item?'selected':''}
          aria-pressed={rate===item}
          onClick={()=>setRate(item)}
          key={item}
        >
          RM{money(item)}
        </button>)}
        <button
          className={rate===null?'selected':''}
          aria-pressed={rate===null}
          onClick={()=>setRate(null)}
        >
          Custom
        </button>
      </div>
      {rate===null&&<label className="custom">
        Custom rate (RM)
        <input
          inputMode="decimal"
          value={custom}
          onChange={event=>setCustom(event.target.value)}
          aria-invalid={custom!==''&&!parseRateCents(custom)}
        />
        <small>RM0.01–RM9.99, maximum 2 decimal places</small>
      </label>}
    </section>

    <section>
      <h2>3. Basket weight</h2>
      <output className="weight" role="group" aria-label="Current basket weight">
        {weight||'0'} <small>kg</small>
      </output>
      <NumericKeypad value={weight} onChange={setWeight}/>
    </section>

    <section className="calculated-section">
      <div className="total">
        <span>Calculated wage</span>
        <strong>RM{money(currentWageCents)}</strong>
      </div>
      <button
        className="entry-confirm"
        disabled={!worker||!selectedRate||!weightOk}
        onClick={()=>addEntry()}
      >
        Confirm entry
      </button>
    </section>

    {duplicate&&<div className="warning" role="alert">
      <strong>Possible duplicate entry.</strong>
      <span>Same worker, weight and rate were just added.</span>
      <button onClick={()=>addEntry(true)}>Add anyway</button>
      <button className="secondary" onClick={()=>setDuplicate(false)}>Cancel</button>
    </div>}

    {message&&<p className="success" role="status" aria-live="polite">✓ {message}</p>}
    {error&&<p className="error" role="alert">{error}</p>}

    {entries.length>0&&worker&&<section className="session-card">
      <div className="session-heading">
        <div>
          <p className="eyebrow">Current worker</p>
          <h2>{worker.name}</h2>
        </div>
        <strong>{entries.length} basket{entries.length===1?'':'s'}</strong>
      </div>

      <ol className="entry-list">
        {entries.map((entry,index)=><li key={entry.localId}>
          <span className="entry-number">{index+1}</span>
          <div className="entry-details">
            <strong>{entry.weightKg}kg × RM{entry.rateRm}</strong>
            <small>Basket wage</small>
          </div>
          <strong className="entry-wage">RM{entry.wageRm}</strong>
          <button
            className="remove-entry"
            type="button"
            aria-label={`Remove entry ${index+1}`}
            onClick={()=>removeEntry(entry.localId)}
          >
            Remove
          </button>
        </li>)}
      </ol>

      <div className="worker-subtotal">
        <div><span>Baskets</span><strong>{entries.length}</strong></div>
        <div><span>Total kg</span><strong>{totalWeight}kg</strong></div>
        <div><span>Worker total</span><strong>RM{money(totalWageCents)}</strong></div>
      </div>

      <button
        className="finalize-worker"
        type="button"
        disabled={savingTotal}
        onClick={()=>void saveWorkerTotal()}
      >
        {savingTotal?'Saving worker total…':'Confirm worker total & save'}
      </button>

      <button
        className="clear-session"
        type="button"
        disabled={savingTotal}
        onClick={clearCurrentWorker}
      >
        Clear current list
      </button>
    </section>}
  </main>
}
