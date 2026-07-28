import { useEffect,useMemo,useState } from 'react'
import { Link } from 'react-router-dom'
import { malaysiaDateKey,money } from '../lib/wage'
import { loadWageEntriesByDate,type StoredWageEntry } from '../services/wages'

interface WorkerSummary {
  workerId:string
  workerName:string
  entries:StoredWageEntry[]
  totalWeight:number
  totalWageCents:number
}

interface Props {
  loader?:(dateKey:string)=>Promise<StoredWageEntry[]>
}

function cents(value:string){
  return Math.round(Number(value)*100)
}

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

export function TodaySummaryPage({loader=loadWageEntriesByDate}:Props){
  const [dateKey,setDateKey]=useState(()=>malaysiaDateKey())
  const [entries,setEntries]=useState<StoredWageEntry[]>([])
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState('')
  const [refreshKey,setRefreshKey]=useState(0)

  useEffect(()=>{
    let active=true
    setLoading(true)
    setError('')

    loader(dateKey)
      .then(result=>{
        if(!active)return
        setEntries([...result].sort((a,b)=>timestampMillis(a.createdAt)-timestampMillis(b.createdAt)))
      })
      .catch(()=>{
        if(!active)return
        setEntries([])
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
      current.totalWageCents+=cents(entry.wageRm)
      grouped.set(key,current)
    }

    return [...grouped.values()].sort((a,b)=>a.workerName.localeCompare(b.workerName))
  },[entries])

  const grandTotal=useMemo(()=>({
    workers:groups.length,
    baskets:entries.length,
    weight:entries.reduce((sum,entry)=>sum+entry.weightKg,0),
    wageCents:entries.reduce((sum,entry)=>sum+cents(entry.wageRm),0),
  }),[entries,groups.length])

  return <main>
    <header>
      <p className="eyebrow">CCM Fishery</p>
      <h1>Daily Summary</h1>
      <Link className="page-link" to="/">← Back to wage entry</Link>
    </header>

    <section className="date-filter">
      <label>
        Record date
        <input type="date" value={dateKey} onChange={event=>setDateKey(event.target.value)}/>
      </label>
      <button type="button" onClick={()=>setRefreshKey(value=>value+1)} disabled={loading}>
        {loading?'Loading…':'Refresh records'}
      </button>
    </section>

    <p className="summary-date">{formatDate(dateKey)}</p>

    {error&&<p className="error" role="alert">{error}</p>}

    <section className="daily-grand-total">
      <div><span>Workers</span><strong>{grandTotal.workers}</strong></div>
      <div><span>Baskets</span><strong>{grandTotal.baskets}</strong></div>
      <div><span>Total kg</span><strong>{grandTotal.weight}kg</strong></div>
      <div><span>Total wage</span><strong>RM{money(grandTotal.wageCents)}</strong></div>
    </section>

    {loading?<p className="notice">Loading daily records…</p>:
      entries.length===0?<p className="notice">No saved wage records for this date.</p>:
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
                <div>
                  <strong>{entry.weightKg}kg × RM{entry.rateRm}</strong>
                  <small>{formatTime(entry.createdAt)}</small>
                </div>
                <strong>RM{entry.wageRm}</strong>
              </li>)}
            </ol>
          </details>
        </section>)}
      </div>
    }
  </main>
}