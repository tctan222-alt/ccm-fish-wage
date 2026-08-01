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
      .catch(()=>{setWorkers([]);setError('无法载入工人，请稍后再试。')})
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
    setMessage(`已加入：${worker.name}，${weightNumber}kg × RM${money(selectedRate)} = RM${money(currentWageCents)}`)
    setWeight('')
    navigator.vibrate?.(40)
    addLock.current=false
  }

  function removeEntry(localId:string){
    setEntries(current=>current.filter(entry=>entry.localId!==localId))
    setMessage('已从当前工人清单移除该篮。')
    setDuplicate(false)
    last.current=null
  }

  function clearCurrentWorker(){
    if(entries.length===0)return
    const approved=window.confirm(`清除 ${worker?.name??'当前工人'} 的全部 ${entries.length} 篮记录吗？`)
    if(!approved)return
    setEntries([])
    setWeight('')
    setMessage('已清除当前工人清单。')
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
        `已保存 ${summary.workerName}：${summary.basketCount} 篮，`+
        `${summary.totalWeight}kg，RM${money(summary.totalWageCents)}`,
      )
      setEntries([])
      setWorker(null)
      setWeight('')
      last.current=null
      navigator.vibrate?.([60,40,60])
    }catch{
      setError('工人合计未保存，清单仍保留。请检查网络后重试。')
    }finally{
      saveLock.current=false
      setSavingTotal(false)
    }
  }

  return <main>
    <header>
      <p className="eyebrow">CCM Fishery</p>
      <h1>切鱼头工钱</h1>
      <Link className="page-link" to="/fish-department">← 返回</Link>
    </header>

    <nav className="summary-nav" aria-label="工钱汇总">
      <Link className="summary-link" to="/today" aria-label="工钱录入">工钱录入</Link>
      <Link className="summary-link monthly" to="/monthly" aria-label="工钱 Summary">工钱 Summary</Link>
    </nav>

    {savedSummary&&<p className="success saved-summary" role="status" aria-live="polite">✓ {savedSummary}</p>}

    <section>
      <h2>1. 工人</h2>
      {workers===null?<p>正在载入工人…</p>:workers.length===0?
        <p className="notice">没有启用中的工人。请先新增或重新启用工人。</p>:
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
        <p className="session-lock">请先完成或清除 <strong>{worker.name}</strong> 的清单，再选择其他工人。</p>
      }
      <Link className="manage-link" to="/workers">新增／管理工人</Link>
    </section>

    <section>
      <h2>2. 工钱单价</h2>
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
          自订
        </button>
      </div>
      {rate===null&&<label className="custom">
        自订单价（RM）
        <input
          inputMode="decimal"
          value={custom}
          onChange={event=>setCustom(event.target.value)}
          aria-invalid={custom!==''&&!parseRateCents(custom)}
        />
        <small>RM0.01–RM9.99，最多两位小数</small>
      </label>}
    </section>

    <section>
      <h2>3. 每篮重量</h2>
      <output className="weight" role="group" aria-label="当前篮重">
        {weight||'0'} <small>kg</small>
      </output>
      <NumericKeypad value={weight} onChange={setWeight}/>
    </section>

    <section className="calculated-section">
      <div className="total">
        <span>计算工钱</span>
        <strong>RM{money(currentWageCents)}</strong>
      </div>
      <button
        className="entry-confirm"
        disabled={!worker||!selectedRate||!weightOk}
        onClick={()=>addEntry()}
      >
        确认加入
      </button>
    </section>

    {duplicate&&<div className="warning" role="alert">
      <strong>可能重复加入。</strong>
      <span>相同工人、重量和单价刚刚已加入。</span>
      <button onClick={()=>addEntry(true)}>仍然加入</button>
      <button className="secondary" onClick={()=>setDuplicate(false)}>取消</button>
    </div>}

    {message&&<p className="success" role="status" aria-live="polite">✓ {message}</p>}
    {error&&<p className="error" role="alert">{error}</p>}

    {entries.length>0&&worker&&<section className="session-card">
      <div className="session-heading">
        <div>
          <p className="eyebrow">当前工人</p>
          <h2>{worker.name}</h2>
        </div>
        <strong>{entries.length} 篮</strong>
      </div>

      <ol className="entry-list">
        {entries.map((entry,index)=><li key={entry.localId}>
          <span className="entry-number">{index+1}</span>
          <div className="entry-details">
            <strong>{entry.weightKg}kg × RM{entry.rateRm}</strong>
            <small>本篮工钱</small>
          </div>
          <strong className="entry-wage">RM{entry.wageRm}</strong>
          <button
            className="remove-entry"
            type="button"
            aria-label={`移除第 ${index+1} 篮`}
            onClick={()=>removeEntry(entry.localId)}
          >
            移除
          </button>
        </li>)}
      </ol>

      <div className="worker-subtotal">
        <div><span>篮数</span><strong>{entries.length}</strong></div>
        <div><span>总 kg</span><strong>{totalWeight}kg</strong></div>
        <div><span>工人合计</span><strong>RM{money(totalWageCents)}</strong></div>
      </div>

      <button
        className="finalize-worker"
        type="button"
        disabled={savingTotal}
        onClick={()=>void saveWorkerTotal()}
      >
        {savingTotal?'正在保存工人合计…':'确认并保存工人合计'}
      </button>

      <button
        className="clear-session"
        type="button"
        disabled={savingTotal}
        onClick={clearCurrentWorker}
      >
        清除当前清单
      </button>
    </section>}
  </main>
}
