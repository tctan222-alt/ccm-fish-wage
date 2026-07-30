import { useCallback,useEffect,useMemo,useRef,useState } from 'react'
import { Link } from 'react-router-dom'
import { MonthlyClosingPanel } from '../components/MonthlyClosingPanel'
import { FIXED_RATE_CENTS,malaysiaMonthKey,money,rmStringToCents } from '../lib/wage'
import {
  closeWageMonth,
  createWagePayment,
  loadWageMonthClosingData,
  reopenWageMonth,
  voidWagePayment,
  type CreatePaymentInput,
  type WageMonthClosingData,
} from '../services/monthClosing'
import {
  loadMonthlyWageData,
  type MonthlyWageData,
  type StoredWageEntry,
  type WageVoidRecord,
} from '../services/wages'

interface Props {
  loader?:(monthKey:string)=>Promise<MonthlyWageData>
  closingLoader?:(monthKey:string)=>Promise<WageMonthClosingData>
  closeHandler?:(monthKey:string)=>Promise<void>
  paymentHandler?:(input:CreatePaymentInput)=>Promise<void>
  voidPaymentHandler?:(monthKey:string,paymentId:string,reason:string)=>Promise<void>
  reopenHandler?:(monthKey:string,reason:string)=>Promise<void>
  requestTimeoutMs?:number
}

const MONTHLY_REQUEST_TIMEOUT_MS=15000

interface WorkerMonthlySummary {
  workerId:string
  workerName:string
  entries:StoredWageEntry[]
  days:Set<string>
  totalWeight:number
  totalWageCents:number
}

interface WorkerDaySummary {
  dateKey:string
  entries:StoredWageEntry[]
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
    weekday:'short',
    month:'short',
    day:'numeric',
  }).format(new Date(`${dateKey}T12:00:00+08:00`))
}

function rateLabel(rateCents:number|null){
  return rateCents===null?'Custom rate':`RM${money(rateCents)}`
}

export function MonthlySummaryPage({
  loader=loadMonthlyWageData,
  closingLoader=loadWageMonthClosingData,
  closeHandler=closeWageMonth,
  paymentHandler=createWagePayment,
  voidPaymentHandler=voidWagePayment,
  reopenHandler=reopenWageMonth,
  requestTimeoutMs=MONTHLY_REQUEST_TIMEOUT_MS,
}:Props){
  const [monthKey,setMonthKey]=useState(()=>malaysiaMonthKey())
  const [entries,setEntries]=useState<StoredWageEntry[]>([])
  const [voids,setVoids]=useState<WageVoidRecord[]>([])
  const [closingData,setClosingData]=useState<WageMonthClosingData>({month:null,statements:[],payments:[]})
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState('')
  const requestIdRef=useRef(0)
  const inFlightRef=useRef(false)
  const mountedRef=useRef(false)
  const timeoutRef=useRef<number|null>(null)

  const clearActiveTimeout=useCallback(()=>{
    if(timeoutRef.current===null)return
    window.clearTimeout(timeoutRef.current)
    timeoutRef.current=null
  },[])

  const finishRequest=useCallback((requestId:number)=>{
    if(requestIdRef.current!==requestId)return
    clearActiveTimeout()
    inFlightRef.current=false
    if(mountedRef.current)setLoading(false)
  },[clearActiveTimeout])

  useEffect(()=>{
    mountedRef.current=true
    return ()=>{
      mountedRef.current=false
      requestIdRef.current+=1
      inFlightRef.current=false
      clearActiveTimeout()
    }
  },[clearActiveTimeout])

  const loadMonth=useCallback((targetMonthKey:string)=>{
    if(inFlightRef.current)return
    const requestId=requestIdRef.current+1
    requestIdRef.current=requestId
    inFlightRef.current=true
    setLoading(true)
    setError('')
    clearActiveTimeout()

    timeoutRef.current=window.setTimeout(()=>{
      if(requestIdRef.current!==requestId)return
      requestIdRef.current=requestId+1
      clearActiveTimeout()
      inFlightRef.current=false
      if(!mountedRef.current)return
      setEntries([])
      setVoids([])
      setError('Monthly records timed out. Check your connection and try again.')
      setLoading(false)
    },requestTimeoutMs)

    Promise.all([loader(targetMonthKey),closingLoader(targetMonthKey)])
      .then(([result,closing])=>{
        if(requestIdRef.current!==requestId||!mountedRef.current)return
        setEntries([...result.entries].sort((a,b)=>a.dateKey.localeCompare(b.dateKey)||a.workerName.localeCompare(b.workerName)))
        setVoids([...result.voids].sort((a,b)=>b.dateKey.localeCompare(a.dateKey)||a.workerName.localeCompare(b.workerName)))
        setClosingData(closing)
      })
      .catch(()=>{
        if(requestIdRef.current!==requestId||!mountedRef.current)return
        setEntries([])
        setVoids([])
        setClosingData({month:null,statements:[],payments:[]})
        setError('Monthly records could not be loaded. Check your connection and try again.')
      })
      .finally(()=>{
        finishRequest(requestId)
      })
  },[clearActiveTimeout,closingLoader,finishRequest,loader,requestTimeoutMs])

  useEffect(()=>{
    loadMonth(monthKey)
  },[loadMonth,monthKey])

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

  const monthlyDayCount=useMemo(()=>new Set(entries.map(entry=>entry.dateKey)).size,[entries])

  const totals=useMemo(()=>({
    workers:workerGroups.length,
    days:monthlyDayCount,
    baskets:entries.length,
    weight:entries.reduce((sum,entry)=>sum+entry.weightKg,0),
    wageCents:entries.reduce((sum,entry)=>sum+rmStringToCents(entry.wageRm),0),
    voids:voids.length,
  }),[entries,monthlyDayCount,voids.length,workerGroups.length])

  function workerDayGroups(group:WorkerMonthlySummary):WorkerDaySummary[]{
    const grouped=new Map<string,WorkerDaySummary>()

    for(const entry of group.entries){
      const current=grouped.get(entry.dateKey)??{
        dateKey:entry.dateKey,
        entries:[],
        totalWeight:0,
        totalWageCents:0,
      }
      current.entries.push(entry)
      current.totalWeight+=entry.weightKg
      current.totalWageCents+=rmStringToCents(entry.wageRm)
      grouped.set(entry.dateKey,current)
    }

    return [...grouped.values()].sort((a,b)=>a.dateKey.localeCompare(b.dateKey))
  }

  function rateTotal(group:WorkerMonthlySummary,rateCents:number|null){
    return group.entries
      .filter(entry=>{
        const entryRateCents=rmStringToCents(entry.rateRm)
        return rateCents===null
          ?!FIXED_RATE_CENTS.includes(entryRateCents as (typeof FIXED_RATE_CENTS)[number])
          :entryRateCents===rateCents
      })
      .reduce((sum,entry)=>sum+rmStringToCents(entry.wageRm),0)
  }

  return <main>
    <header>
      <p className="eyebrow">CCM Fishery</p>
      <h1>Monthly Summary</h1>
      <Link className="page-link" to="/">Back to wage entry</Link>
    </header>

    <section className="date-filter">
      <label>
        Wage month
        <input
          type="month"
          value={monthKey}
          disabled={loading}
          onChange={event=>{
            setMonthKey(event.target.value)
            setError('')
          }}
        />
      </label>
      <button type="button" onClick={()=>loadMonth(monthKey)} disabled={loading}>
        {loading?'Loading...':'Refresh month'}
      </button>
    </section>

    <p className="summary-date">{formatMonth(monthKey)}</p>

    {error&&<p className="error" role="alert">{error}</p>}

    {!loading&&<MonthlyClosingPanel
      monthKey={monthKey}
      liveEntries={entries}
      data={closingData}
      onClose={async target=>{await closeHandler(target);loadMonth(target)}}
      onPayment={async input=>{await paymentHandler(input);loadMonth(input.monthKey)}}
      onVoidPayment={async(target,paymentId,reason)=>{await voidPaymentHandler(target,paymentId,reason);loadMonth(target)}}
      onReopen={async(target,reason)=>{await reopenHandler(target,reason);loadMonth(target)}}
    />}

    {closingData.month?.status!=='closed'&&<><section className="monthly-grand-total" aria-label="Monthly totals">
      <div><span>Workers</span><strong>{totals.workers}</strong></div>
      <div><span>Work days</span><strong>{totals.days}</strong></div>
      <div><span>Baskets</span><strong>{totals.baskets}</strong></div>
      <div><span>Total kg</span><strong>{totals.weight}kg</strong></div>
      <div><span>Total wage</span><strong>RM{money(totals.wageCents)}</strong></div>
      <div><span>Voided</span><strong>{totals.voids}</strong></div>
    </section>

    {loading?<p className="notice">Loading monthly records...</p>:
      entries.length===0?<p className="notice">No active wage records for this month.</p>:
      <div className="monthly-worker-list">
        {workerGroups.map(group=><section className="monthly-worker-card" key={group.workerId||group.workerName}>
          <div className="daily-worker-heading">
            <div>
              <p className="eyebrow">Worker</p>
              <h2>{group.workerName}</h2>
            </div>
            <strong>RM{money(group.totalWageCents)}</strong>
          </div>

          <div className="monthly-worker-total">
            <div><span>Baskets</span><strong>{group.entries.length}</strong></div>
            <div><span>Total kg</span><strong>{group.totalWeight}kg</strong></div>
            <div><span>Total wage</span><strong>RM{money(group.totalWageCents)}</strong></div>
          </div>

          <div className="rate-breakdown">
            {[...FIXED_RATE_CENTS,null].map(rate=><div key={rateLabel(rate)}>
              <span>{rateLabel(rate)}</span>
              <strong>RM{money(rateTotal(group,rate))}</strong>
            </div>)}
          </div>

          <details className="monthly-days">
            <summary>View daily totals and basket details</summary>
            {workerDayGroups(group).map(day=><details key={day.dateKey}>
              <summary>
                <span>{formatShortDate(day.dateKey)}</span>
                <strong>{day.entries.length} basket{day.entries.length===1?'':'s'} · {day.totalWeight}kg · RM{money(day.totalWageCents)}</strong>
              </summary>
              <ol className="saved-entry-list">
                {day.entries.map((entry,index)=><li key={entry.id}>
                  <span className="entry-number">{index+1}</span>
                  <div className="saved-entry-details">
                    <strong>{entry.weightKg}kg x RM{entry.rateRm}</strong>
                    <small>{entry.dateKey}</small>
                  </div>
                  <strong className="saved-entry-wage">RM{entry.wageRm}</strong>
                </li>)}
              </ol>
              <Link className="open-day-link" to={`/today?date=${day.dateKey}`}>Open day</Link>
            </details>)}
          </details>
        </section>)}
      </div>
    }</>}

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
