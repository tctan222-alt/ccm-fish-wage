import { useEffect,useMemo,useRef,useState } from 'react'
import { Link,useSearchParams } from 'react-router-dom'
import { malaysiaDateKey,money,rmStringToCents } from '../lib/wage'
import {
  loadDailyWageData,
  voidWageEntry,
  type DailyWageData,
  type StoredWageEntry,
  type WageVoidRecord,
} from '../services/wages'

interface WorkerSummary {
  workerId:string
  workerName:string
  entries:StoredWageEntry[]
  totalWeight:number
  totalWageCents:number
}

interface Props {
  loader?:(dateKey:string)=>Promise<DailyWageData>
  voider?:(entry:StoredWageEntry,reason:string)=>Promise<void>
}

const VOID_REASONS=[
  'Wrong kg',
  'Wrong rate',
  'Wrong worker',
  'Duplicate entry',
  'Other',
] as const

function timestampMillis(value:unknown){
  if(!value||typeof value!=='object')return 0
  const candidate=value as {toMillis?:()=>number}
  return typeof candidate.toMillis==='function'?candidate.toMillis():0
}

function formatTime(value:unknown){
  if(!value||typeof value!=='object')return '—'
  const candidate=value as {toDate?:()=>Date}
  if(typeof candidate.toDate!=='function')return '—'
  return new Intl.DateTimeFormat('en-MY',{
    timeZone:'Asia/Kuala_Lumpur',
    hour:'2-digit',
    minute:'2-digit',
  }).format(candidate.toDate())
}

function formatDate(dateKey:string){
  return new Intl.DateTimeFormat('en-MY',{
    timeZone:'Asia/Kuala_Lumpur',
    dateStyle:'full',
  }).format(new Date(`${dateKey}T12:00:00+08:00`))
}

export function TodaySummaryPage({
  loader=loadDailyWageData,
  voider=voidWageEntry,
}:Props){
  const [searchParams]=useSearchParams()
  const requestedDate=searchParams.get('date')
  const initialDate=requestedDate&&/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)?requestedDate:malaysiaDateKey()
  const [dateKey,setDateKey]=useState(initialDate)
  const [entries,setEntries]=useState<StoredWageEntry[]>([])
  const [voids,setVoids]=useState<WageVoidRecord[]>([])
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState('')
  const [message,setMessage]=useState('')
  const [refreshKey,setRefreshKey]=useState(0)

  const [pendingVoid,setPendingVoid]=useState<StoredWageEntry|null>(null)
  const [reason,setReason]=useState<(typeof VOID_REASONS)[number]>('Wrong kg')
  const [otherReason,setOtherReason]=useState('')
  const [voiding,setVoiding]=useState(false)
  const voidLock=useRef(false)

  useEffect(()=>{
    let active=true
    setLoading(true)
    setError('')

    loader(dateKey)
      .then(result=>{
        if(!active)return
        setEntries(
          [...result.entries].sort(
            (a,b)=>timestampMillis(a.createdAt)-timestampMillis(b.createdAt),
          ),
        )
        setVoids(
          [...result.voids].sort(
            (a,b)=>timestampMillis(b.voidedAt)-timestampMillis(a.voidedAt),
          ),
        )
      })
      .catch(()=>{
        if(!active)return
        setEntries([])
        setVoids([])
        setError('Records could not be loaded. Check your connection and try again.')
      })
      .finally(()=>{
        if(active)setLoading(false)
      })

    return ()=>{active=false}
  },[dateKey,loader,refreshKey])

  const groups=useMemo(()=>{
    const grouped=new Map<string,WorkerSummary>()

    for(const entry of entries){
      const key=entry.workerId||entry.workerName
      const current=grouped.get(key)??{
        workerId:entry.workerId,
        workerName:entry.workerName,
        entries:[],
        totalWeight:0,
        totalWageCents:0,
      }
      current.entries.push(entry)
      current.totalWeight+=entry.weightKg
      current.totalWageCents+=rmStringToCents(entry.wageRm)
      grouped.set(key,current)
    }

    return [...grouped.values()].sort((a,b)=>a.workerName.localeCompare(b.workerName))
  },[entries])

  const grandTotal=useMemo(()=>({
    workers:groups.length,
    baskets:entries.length,
    weight:entries.reduce((sum,entry)=>sum+entry.weightKg,0),
    wageCents:entries.reduce((sum,entry)=>sum+rmStringToCents(entry.wageRm),0),
  }),[entries,groups.length])

  const resolvedReason=reason==='Other'?otherReason.trim():reason
  const canConfirmVoid=resolvedReason.length>0&&resolvedReason.length<=100&&!voiding

  function openVoid(entry:StoredWageEntry){
    setPendingVoid(entry)
    setReason('Wrong kg')
    setOtherReason('')
    setError('')
    setMessage('')
  }

  function closeVoid(){
    if(voiding)return
    setPendingVoid(null)
    setOtherReason('')
  }

  async function confirmVoid(){
    if(voidLock.current||!pendingVoid||!canConfirmVoid)return

    voidLock.current=true
    setVoiding(true)
    setError('')
    setMessage('')

    const voidedEntry=pendingVoid
    try{
      await voider(voidedEntry,resolvedReason)
      setPendingVoid(null)
      setMessage(
        `Voided: ${voidedEntry.workerName}, ${voidedEntry.weightKg}kg × `+
        `RM${voidedEntry.rateRm} = RM${voidedEntry.wageRm}`,
      )
      setRefreshKey(value=>value+1)
      navigator.vibrate?.([60,40,60])
    }catch{
      setError('Record was not voided. Nothing was changed. Check your connection and try again.')
    }finally{
      voidLock.current=false
      setVoiding(false)
    }
  }

  return <main>
    <header>
      <p className="eyebrow">CCM Fishery</p>
      <h1>Daily Summary</h1>
      <Link className="page-link" to="/">← Back to wage entry</Link>
      <Link className="page-link" to="/monthly">Monthly Summary</Link>
    </header>

    <section className="date-filter">
      <label>
        Record date
        <input
          type="date"
          value={dateKey}
          onChange={event=>{
            setDateKey(event.target.value)
            setPendingVoid(null)
            setMessage('')
          }}
        />
      </label>
      <button type="button" onClick={()=>setRefreshKey(value=>value+1)} disabled={loading}>
        {loading?'Loading…':'Refresh records'}
      </button>
    </section>

    <p className="summary-date">{formatDate(dateKey)}</p>

    {message&&<p className="success" role="status" aria-live="polite">✓ {message}</p>}
    {error&&<p className="error" role="alert">{error}</p>}

    <section className="daily-grand-total">
      <div><span>Workers</span><strong>{grandTotal.workers}</strong></div>
      <div><span>Baskets</span><strong>{grandTotal.baskets}</strong></div>
      <div><span>Total kg</span><strong>{grandTotal.weight}kg</strong></div>
      <div><span>Total wage</span><strong>RM{money(grandTotal.wageCents)}</strong></div>
    </section>

    {loading?<p className="notice">Loading daily records…</p>:
      entries.length===0?<p className="notice">No active wage records for this date.</p>:
      <div className="daily-worker-groups">
        {groups.map(group=><section className="daily-worker-card" key={group.workerId||group.workerName}>
          <div className="daily-worker-heading">
            <div>
              <p className="eyebrow">Worker</p>
              <h2>{group.workerName}</h2>
            </div>
            <strong>RM{money(group.totalWageCents)}</strong>
          </div>

          <div className="daily-worker-total">
            <div><span>Baskets</span><strong>{group.entries.length}</strong></div>
            <div><span>Total kg</span><strong>{group.totalWeight}kg</strong></div>
            <div><span>Wage</span><strong>RM{money(group.totalWageCents)}</strong></div>
          </div>

          <details>
            <summary>View {group.entries.length} individual record{group.entries.length===1?'':'s'}</summary>
            <ol className="saved-entry-list">
              {group.entries.map((entry,index)=><li key={entry.id}>
                <span className="entry-number">{index+1}</span>
                <div className="saved-entry-details">
                  <strong>{entry.weightKg}kg × RM{entry.rateRm}</strong>
                  <small>{formatTime(entry.createdAt)}</small>
                </div>
                <strong className="saved-entry-wage">RM{entry.wageRm}</strong>
                <button
                  className="void-entry-button"
                  type="button"
                  onClick={()=>openVoid(entry)}
                >
                  Void
                </button>
              </li>)}
            </ol>
          </details>
        </section>)}
      </div>
    }

    <section className="void-history">
      <details>
        <summary>Voided records ({voids.length})</summary>
        {voids.length===0?<p className="notice">No voided records for this date.</p>:
          <ol className="void-history-list">
            {voids.map((item,index)=><li key={item.id}>
              <div className="void-history-heading">
                <span className="entry-number">{index+1}</span>
                <strong>{item.workerName}</strong>
                <strong>RM{item.wageRm}</strong>
              </div>
              <p>{item.weightKg}kg × RM{item.rateRm}</p>
              <p><strong>Reason:</strong> {item.voidReason}</p>
              <small>Voided at {formatTime(item.voidedAt)}</small>
            </li>)}
          </ol>
        }
      </details>
    </section>

    {pendingVoid&&<div className="void-overlay" role="presentation" onClick={closeVoid}>
      <section
        className="void-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="void-title"
        onClick={event=>event.stopPropagation()}
      >
        <p className="eyebrow">Audit action</p>
        <h2 id="void-title">Void this record?</h2>

        <div className="void-entry-preview">
          <strong>{pendingVoid.workerName}</strong>
          <span>{pendingVoid.weightKg}kg × RM{pendingVoid.rateRm}</span>
          <strong>RM{pendingVoid.wageRm}</strong>
        </div>

        <p className="void-warning">
          The original record will remain in Firestore and will be marked void.
          Daily totals will exclude it.
        </p>

        <fieldset className="void-reasons">
          <legend>Reason</legend>
          {VOID_REASONS.map(item=><label key={item}>
            <input
              type="radio"
              name="void-reason"
              checked={reason===item}
              onChange={()=>setReason(item)}
            />
            <span>{item}</span>
          </label>)}
        </fieldset>

        {reason==='Other'&&<label className="other-reason">
          Other reason
          <input
            autoFocus
            maxLength={100}
            value={otherReason}
            onChange={event=>setOtherReason(event.target.value)}
            placeholder="Enter the reason"
          />
          <small>{otherReason.length}/100</small>
        </label>}

        <button
          className="confirm-void"
          type="button"
          disabled={!canConfirmVoid}
          onClick={()=>void confirmVoid()}
        >
          {voiding?'Voiding…':'Confirm void'}
        </button>

        <button
          className="cancel-void"
          type="button"
          disabled={voiding}
          onClick={closeVoid}
        >
          Cancel
        </button>
      </section>
    </div>}
  </main>
}
