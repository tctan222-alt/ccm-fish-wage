import { useEffect,useMemo,useState } from 'react'
import { Link } from 'react-router-dom'
import { malaysiaMonthKey,money,rmStringToCents } from '../lib/wage'
import {
  loadMonthlyWageData,
  type MonthlyWageData,
  type StoredWageEntry,
  type WageVoidRecord,
} from '../services/wages'

interface Props {
  loader?:(monthKey:string)=>Promise<MonthlyWageData>
}

interface WorkerMonthlySummary {
  workerId:string
  workerName:string
  entries:StoredWageEntry[]
  days:Set<string>
  totalWeight:number
  totalWageCents:number
}

function formatMonth(monthKey:string){
  return new Intl.DateTimeFormat('en-MY',{
    timeZone:'Asia/Kuala_Lumpur',
    month:'long',
    year:'numeric',
  }).format(new Date(`${monthKey}-01T12:00:00+08:00`))
}

function formatShortDate(dateKey:string){
  return new Intl.DateTimeFormat('en-MY',{
    timeZone:'Asia/Kuala_Lumpur',
    month:'short',
    day:'numeric',
  }).format(new Date(`${dateKey}T12:00:00+08:00`))
}

export function MonthlySummaryPage({loader=loadMonthlyWageData}:Props){
  const [monthKey,setMonthKey]=useState(()=>malaysiaMonthKey())
  const [entries,setEntries]=useState<StoredWageEntry[]>([])
  const [voids,setVoids]=useState<WageVoidRecord[]>([])
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState('')
  const [refreshKey,setRefreshKey]=useState(0)

  useEffect(()=>{
    let active=true
    setLoading(true)
    setError('')

    loader(monthKey)
      .then(result=>{
        if(!active)return
        setEntries([...result.entries].sort((a,b)=>a.dateKey.localeCompare(b.dateKey)||a.workerName.localeCompare(b.workerName)))
        setVoids([...result.voids].sort((a,b)=>b.dateKey.localeCompare(a.dateKey)||a.workerName.localeCompare(b.workerName)))
      })
      .catch(()=>{
        if(!active)return
        setEntries([])
        setVoids([])
        setError('Monthly records could not be loaded. Check your connection and try again.')
      })
      .finally(()=>{
        if(active)setLoading(false)
      })

    return ()=>{active=false}
  },[loader,monthKey,refreshKey])

  const workerGroups=useMemo(()=>{
    const grouped=new Map<string,WorkerMonthlySummary>()

    for(const entry of entries){
      const key=entry.workerId||entry.workerName
      const current=grouped.get(key)??{
        workerId:entry.workerId,
        workerName:entry.workerName,
        entries:[],
        days:new Set<string>(),
        totalWeight:0,
        totalWageCents:0,
      }
      current.entries.push(entry)
      current.days.add(entry.dateKey)
      current.totalWeight+=entry.weightKg
      current.totalWageCents+=rmStringToCents(entry.wageRm)
      grouped.set(key,current)
    }

    return [...grouped.values()].sort((a,b)=>b.totalWageCents-a.totalWageCents||a.workerName.localeCompare(b.workerName))
  },[entries])

  const dayGroups=useMemo(()=>{
    const grouped=new Map<string,{dateKey:string;baskets:number;weight:number;wageCents:number}>()

    for(const entry of entries){
      const current=grouped.get(entry.dateKey)??{
        dateKey:entry.dateKey,
        baskets:0,
        weight:0,
        wageCents:0,
      }
      current.baskets+=1
      current.weight+=entry.weightKg
      current.wageCents+=rmStringToCents(entry.wageRm)
      grouped.set(entry.dateKey,current)
    }

    return [...grouped.values()].sort((a,b)=>a.dateKey.localeCompare(b.dateKey))
  },[entries])

  const totals=useMemo(()=>({
    workers:workerGroups.length,
    days:dayGroups.length,
    baskets:entries.length,
    weight:entries.reduce((sum,entry)=>sum+entry.weightKg,0),
    wageCents:entries.reduce((sum,entry)=>sum+rmStringToCents(entry.wageRm),0),
    voids:voids.length,
  }),[dayGroups.length,entries,voids.length,workerGroups.length])

  return <main>
    <header>
      <p className="eyebrow">CCM Fishery</p>
      <h1>Monthly Summary</h1>
      <Link className="page-link" to="/">Back to wage entry</Link>
    </header>

    <section className="date-filter">
      <label>
        Month
        <input
          type="month"
          value={monthKey}
          onChange={event=>{
            setMonthKey(event.target.value)
            setError('')
          }}
        />
      </label>
      <button type="button" onClick={()=>setRefreshKey(value=>value+1)} disabled={loading}>
        {loading?'Loading...':'Refresh month'}
      </button>
    </section>

    <p className="summary-date">{formatMonth(monthKey)}</p>

    {error&&<p className="error" role="alert">{error}</p>}

    <section className="monthly-grand-total">
      <div><span>Workers</span><strong>{totals.workers}</strong></div>
      <div><span>Work days</span><strong>{totals.days}</strong></div>
      <div><span>Baskets</span><strong>{totals.baskets}</strong></div>
      <div><span>Total kg</span><strong>{totals.weight}kg</strong></div>
      <div><span>Total wage</span><strong>RM{money(totals.wageCents)}</strong></div>
      <div><span>Voided</span><strong>{totals.voids}</strong></div>
    </section>

    {loading?<p className="notice">Loading monthly records...</p>:
      entries.length===0?<p className="notice">No active wage records for this month.</p>:
      <>
        <section>
          <h2>Worker Totals</h2>
          <div className="monthly-worker-list">
            {workerGroups.map(group=><article className="monthly-worker-row" key={group.workerId||group.workerName}>
              <div>
                <strong>{group.workerName}</strong>
                <small>{group.days.size} day{group.days.size===1?'':'s'} · {group.entries.length} basket{group.entries.length===1?'':'s'}</small>
              </div>
              <div><span>Total kg</span><strong>{group.totalWeight}kg</strong></div>
              <div><span>Wage</span><strong>RM{money(group.totalWageCents)}</strong></div>
            </article>)}
          </div>
        </section>

        <section>
          <h2>Daily Totals</h2>
          <div className="monthly-day-list">
            {dayGroups.map(day=><article className="monthly-day-row" key={day.dateKey}>
              <div>
                <strong>{formatShortDate(day.dateKey)}</strong>
                <small>{day.baskets} basket{day.baskets===1?'':'s'}</small>
              </div>
              <div><span>Total kg</span><strong>{day.weight}kg</strong></div>
              <div><span>Wage</span><strong>RM{money(day.wageCents)}</strong></div>
              <Link to={`/today?date=${day.dateKey}`}>Open day</Link>
            </article>)}
          </div>
        </section>
      </>
    }

    <section className="void-history">
      <details>
        <summary>Voided records this month ({voids.length})</summary>
        {voids.length===0?<p className="notice">No voided records for this month.</p>:
          <ol className="void-history-list">
            {voids.map((item,index)=><li key={item.id}>
              <div className="void-history-heading">
                <span className="entry-number">{index+1}</span>
                <strong>{item.workerName}</strong>
                <strong>RM{item.wageRm}</strong>
              </div>
              <p>{item.dateKey}: {item.weightKg}kg x RM{item.rateRm}</p>
              <p><strong>Reason:</strong> {item.voidReason}</p>
            </li>)}
          </ol>
        }
      </details>
    </section>
  </main>
}
