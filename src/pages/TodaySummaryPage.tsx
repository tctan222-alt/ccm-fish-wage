import { useEffect,useMemo,useRef,useState } from 'react'
import { Link,useSearchParams } from 'react-router-dom'
import { businessDateFromLegacy } from '../lib/businessDate'
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

const VOID_REASON_LABELS:Record<(typeof VOID_REASONS)[number],string>={
  'Wrong kg':'重量错误',
  'Wrong rate':'单价错误',
  'Wrong worker':'工人错误',
  'Duplicate entry':'重复记录',
  'Other':'其他',
}

function voidReasonLabel(value:string){
  return Object.hasOwn(VOID_REASON_LABELS,value)?VOID_REASON_LABELS[value as keyof typeof VOID_REASON_LABELS]:value
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
  return businessDateFromLegacy(dateKey)
}

interface GrandTotal {
  workers:number
  baskets:number
  weight:number
  wageCents:number
}

function validDateKey(value:string|null):value is string {
  if(!value||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false
  try{businessDateFromLegacy(value);return true}catch{return false}
}

function BasketRecords({entries,onVoid}:{entries:StoredWageEntry[];onVoid?:(entry:StoredWageEntry)=>void}){
  return <table className="daily-basket-table" aria-label="每篮工钱明细">
    <thead><tr>
      <th scope="col">序号</th><th scope="col">kg</th><th scope="col">RM/kg</th>
      <th scope="col">工钱</th><th scope="col">记录时间</th>{onVoid&&<th scope="col">操作</th>}
    </tr></thead>
    <tbody>{entries.map((entry,index)=><tr key={entry.id}>
      <td data-label="序号">{index+1}</td>
      <td data-label="重量">{entry.weightKg}kg</td>
      <td data-label="单价">RM{entry.rateRm}</td>
      <td data-label="工钱">RM{entry.wageRm}</td>
      <td data-label="记录时间">{formatTime(entry.createdAt)}</td>
      {onVoid&&<td><button className="void-entry-button" type="button" onClick={()=>onVoid(entry)}>作废</button></td>}
    </tr>)}</tbody>
  </table>
}

function WorkerSubtotal({group}:{group:WorkerSummary}){
  return <div className="daily-worker-total" aria-label={`${group.workerName}小计`}>
    <div><span>小计篮数</span><strong>{group.entries.length}</strong></div>
    <div><span>总重量</span><strong>{group.totalWeight}kg</strong></div>
    <div><span>工钱小计</span><strong>RM{money(group.totalWageCents)}</strong></div>
  </div>
}

function DailyGrandTotal({total}:{total:GrandTotal}){
  return <section className="daily-grand-total" aria-label="每日总计">
    <div><span>工人数</span><strong>{total.workers}</strong></div>
    <div><span>总篮数</span><strong>{total.baskets}</strong></div>
    <div><span>总重量</span><strong>{total.weight}kg</strong></div>
    <div><span>总工钱</span><strong>RM{money(total.wageCents)}</strong></div>
  </section>
}

export function TodaySummaryPage({
  loader=loadDailyWageData,
  voider=voidWageEntry,
}:Props){
  const [searchParams,setSearchParams]=useSearchParams()
  const requestedDate=searchParams.get('date')
  const dateKey=validDateKey(requestedDate)?requestedDate:malaysiaDateKey()
  const [entries,setEntries]=useState<StoredWageEntry[]>([])
  const [voids,setVoids]=useState<WageVoidRecord[]>([])
  const [loadingState,setLoading]=useState(true)
  const [loadError,setLoadError]=useState('')
  const [error,setError]=useState('')
  const [message,setMessage]=useState('')
  const [refreshKey,setRefreshKey]=useState(0)
  const [completedRequest,setCompletedRequest]=useState<{dateKey:string;refreshKey:number;loader:Props['loader']}|null>(null)
  const currentRequest=completedRequest?.dateKey===dateKey&&completedRequest.refreshKey===refreshKey&&completedRequest.loader===loader
  // URL navigation changes the date before effects run; never show or print the previous report under a new date.
  const loading=loadingState||!currentRequest

  const [pendingVoid,setPendingVoid]=useState<StoredWageEntry|null>(null)
  const [reason,setReason]=useState<(typeof VOID_REASONS)[number]>('Wrong kg')
  const [otherReason,setOtherReason]=useState('')
  const [voiding,setVoiding]=useState(false)
  const voidLock=useRef(false)

  useEffect(()=>{
    let active=true
    setLoading(true)
    setLoadError('')
    setError('')
    setPendingVoid(null)
    setEntries([])
    setVoids([])

    loader(dateKey)
      .then(result=>{
        if(!active)return
        setEntries(
          result.entries.filter(entry=>entry.deleted===false).sort(
            (a,b)=>timestampMillis(a.createdAt)-timestampMillis(b.createdAt)||a.id.localeCompare(b.id),
          ),
        )
        setVoids(
          [...result.voids].sort(
            (a,b)=>timestampMillis(b.voidedAt)-timestampMillis(a.voidedAt)||a.id.localeCompare(b.id),
          ),
        )
      })
      .catch(()=>{
        if(!active)return
        setEntries([])
        setVoids([])
        setLoadError('无法载入每日工钱记录，请检查网络后重试。')
      })
      .finally(()=>{
        if(active){
          setCompletedRequest({dateKey,refreshKey,loader})
          setLoading(false)
        }
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

    return [...grouped.values()].sort((a,b)=>a.workerName.localeCompare(b.workerName)||a.workerId.localeCompare(b.workerId))
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
        `已作废：${voidedEntry.workerName}，${voidedEntry.weightKg}kg × `+
        `RM${voidedEntry.rateRm} = RM${voidedEntry.wageRm}`,
      )
      setRefreshKey(value=>value+1)
      navigator.vibrate?.([60,40,60])
    }catch{
      setError('作废失败，记录未修改。请检查网络后重试。')
    }finally{
      voidLock.current=false
      setVoiding(false)
    }
  }

  const reportReady=!loading&&!loadError
  const canPrint=reportReady&&entries.length>0&&!pendingVoid&&!voiding

  function printReport(){
    if(!canPrint)return
    setError('')
    try{window.print()}catch{setError('无法打开打印界面，请重试或检查浏览器设置。')}
  }

  return <main className="daily-details-page">
    <header>
      <p className="eyebrow">CCM Fishery</p>
      <h1>切鱼头工钱每日明细</h1>
      <small className="daily-english-title">Daily Details</small>
      <nav className="daily-navigation" aria-label="工钱导航">
        <Link className="page-link" to="/fish-head-wages">← 返回工钱录入</Link>
        <Link className="page-link" to="/monthly">月度汇总</Link>
        <Link className="page-link" to="/master-data">基本资料</Link>
      </nav>
    </header>

    <section className="date-filter daily-controls">
      <label>
        日期
        <input
          type="date"
          value={dateKey}
          onChange={event=>{
            if(!validDateKey(event.target.value))return
            setSearchParams(params=>{
              const updated=new URLSearchParams(params)
              updated.set('date',event.target.value)
              return updated
            },{replace:true})
            setPendingVoid(null)
            setMessage('')
          }}
        />
      </label>
      <button type="button" onClick={()=>setRefreshKey(value=>value+1)} disabled={loading}>
        {loading?'载入中…':'刷新'}
      </button>
      <button type="button" onClick={printReport} disabled={!canPrint}>打印 Print</button>
    </section>

    <p className="summary-date">{formatDate(dateKey)}</p>

    {requestedDate!==null&&!validDateKey(requestedDate)&&<p className="notice daily-feedback" role="status">日期无效，已显示今天的记录。</p>}

    {message&&<p className="success daily-feedback" role="status" aria-live="polite">✓ {message}</p>}
    {!loading&&loadError&&<div className="daily-feedback"><p className="error" role="alert">{loadError}</p><button type="button" onClick={()=>setRefreshKey(value=>value+1)}>重试</button></div>}
    {error&&<p className="error daily-feedback" role="alert">{error}</p>}

    {loading?<p className="notice daily-feedback" role="status">正在载入每日工钱明细…</p>:
      loadError?null:entries.length===0?<p className="notice daily-feedback">此日期没有有效工钱记录。</p>:
      <section className="daily-report-screen" aria-label="每日工钱明细">
        <DailyGrandTotal total={grandTotal}/>
        <div className="daily-worker-groups">
        {groups.map(group=><section className="daily-worker-card" key={group.workerId||group.workerName}>
          <div className="daily-worker-heading">
            <div>
              <p className="eyebrow">工人</p>
              <h2>{group.workerName}</h2>
            </div>
            <strong>RM{money(group.totalWageCents)}</strong>
          </div>

          <WorkerSubtotal group={group}/>

          <details>
            <summary>查看 {group.entries.length} 篮明细</summary>
            <BasketRecords entries={group.entries} onVoid={openVoid}/>
          </details>
        </section>)}
        </div>
      </section>
    }

    {reportReady&&entries.length>0&&<section className="daily-report-print" aria-label="每日工钱打印报表" aria-hidden="true">
      {groups.map(group=><section className="daily-print-worker" key={group.workerId||group.workerName}>
        <h2>{group.workerName}</h2>
        <BasketRecords entries={group.entries}/>
        <WorkerSubtotal group={group}/>
      </section>)}
      <DailyGrandTotal total={grandTotal}/>
    </section>}

    {reportReady&&<section className="void-history daily-void-history">
      <details>
        <summary>作废记录 ({voids.length})</summary>
        {voids.length===0?<p className="notice">此日期没有作废记录。</p>:
          <ol className="void-history-list">
            {voids.map((item,index)=><li key={item.id}>
              <div className="void-history-heading">
                <span className="entry-number">{index+1}</span>
                <strong>{item.workerName}</strong>
                <strong>RM{item.wageRm}</strong>
              </div>
              <p>{item.weightKg}kg × RM{item.rateRm}</p>
              <p><strong>原因：</strong> {voidReasonLabel(item.voidReason)}</p>
              <small>作废时间 {formatTime(item.voidedAt)}</small>
            </li>)}
          </ol>
        }
      </details>
    </section>}

    {pendingVoid&&<div className="void-overlay daily-void-modal" role="presentation" onClick={closeVoid}>
      <section
        className="void-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="void-title"
        onClick={event=>event.stopPropagation()}
      >
        <p className="eyebrow">审计操作</p>
        <h2 id="void-title">作废这笔记录？</h2>

        <div className="void-entry-preview">
          <strong>{pendingVoid.workerName}</strong>
          <span>{pendingVoid.weightKg}kg × RM{pendingVoid.rateRm}</span>
          <strong>RM{pendingVoid.wageRm}</strong>
        </div>

        <p className="void-warning">
          原始记录会保留并标记为作废，每日总计将排除此记录。
        </p>

        <fieldset className="void-reasons">
          <legend>原因</legend>
          {VOID_REASONS.map(item=><label key={item}>
            <input
              type="radio"
              name="void-reason"
              checked={reason===item}
              onChange={()=>setReason(item)}
            />
            <span>{VOID_REASON_LABELS[item]}</span>
          </label>)}
        </fieldset>

        {reason==='Other'&&<label className="other-reason">
          其他原因
          <input
            autoFocus
            maxLength={100}
            value={otherReason}
            onChange={event=>setOtherReason(event.target.value)}
            placeholder="请输入原因"
          />
          <small>{otherReason.length}/100</small>
        </label>}

        <button
          className="confirm-void"
          type="button"
          disabled={!canConfirmVoid}
          onClick={()=>void confirmVoid()}
        >
          {voiding?'正在作废…':'确认作废'}
        </button>

        <button
          className="cancel-void"
          type="button"
          disabled={voiding}
          onClick={closeVoid}
        >
          取消
        </button>
      </section>
    </div>}
  </main>
}
