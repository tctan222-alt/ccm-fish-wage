import { useMemo,useState,type FormEvent } from 'react'
import { useUnsavedChanges } from './dirtyState'
import { Link } from 'react-router-dom'
import { malaysiaDateKey,money,rmStringToCents } from '../lib/wage'
import { paymentStatus } from '../lib/monthClosing'
import type { StoredWageEntry } from '../services/wages'
import type {
  CreatePaymentInput,
  WageMonthClosingData,
  WagePaymentRecord,
  WageStatementRecord,
} from '../services/monthClosing'

interface Props {
  showPaymentTracking?:boolean
  monthKey:string
  liveEntries:StoredWageEntry[]
  data:WageMonthClosingData
  onClose:(monthKey:string)=>Promise<void>|void
  onPayment:(input:CreatePaymentInput)=>Promise<void>|void
  onVoidPayment:(monthKey:string,paymentId:string,reason:string)=>Promise<void>|void
  onReopen:(monthKey:string,reason:string)=>Promise<void>|void
}

function monthLabel(monthKey:string){
  return new Intl.DateTimeFormat('en-MY',{month:'long',year:'numeric',timeZone:'Asia/Kuala_Lumpur'})
    .format(new Date(`${monthKey}-01T12:00:00+08:00`))
}

function timestampLabel(value:unknown){
  if(value&&typeof value==='object'&&'toDate' in value&&typeof value.toDate==='function'){
    return new Intl.DateTimeFormat('en-MY',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Kuala_Lumpur'}).format(value.toDate())
  }
  return 'Recorded'
}

export function MonthlyClosingPanel({monthKey,liveEntries,data,onClose,onPayment,onVoidPayment,onReopen,showPaymentTracking=true}:Props){
  const [confirmClose,setConfirmClose]=useState(false)
  const [paymentStatement,setPaymentStatement]=useState<WageStatementRecord|null>(null)
  const [paymentAmount,setPaymentAmount]=useState('')
  const [paymentMethod,setPaymentMethod]=useState<CreatePaymentInput['method']>('cash')
  const [paymentDate,setPaymentDate]=useState(()=>malaysiaDateKey())
  const [reference,setReference]=useState('')
  const [note,setNote]=useState('')
  const [paymentBaseline,setPaymentBaseline]=useState('')
  const [voidPayment,setVoidPayment]=useState<WagePaymentRecord|null>(null)
  const [voidReason,setVoidReason]=useState('')
  const [showReopen,setShowReopen]=useState(false)
  const [reopenReason,setReopenReason]=useState('')
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const paymentDirty=!!paymentStatement&&JSON.stringify([paymentAmount,paymentMethod,paymentDate,reference,note])!==paymentBaseline
  useUnsavedChanges(paymentDirty || (!!voidPayment && !!voidReason) || (showReopen && !!reopenReason))

  const liveTotals=useMemo(()=>{
    const active=liveEntries.filter(entry=>entry.deleted!==true)
    return {
      workers:new Set(active.map(entry=>entry.workerId||entry.workerName)).size,
      baskets:active.length,
      weight:active.reduce((sum,entry)=>sum+entry.weightKg,0),
      wageCents:active.reduce((sum,entry)=>sum+rmStringToCents(entry.wageRm),0),
    }
  },[liveEntries])
  const closed=data.month?.status==='closed'

  async function perform(action:()=>Promise<void>|void){
    setBusy(true)
    setError('')
    try{await action()}
    catch(problem){setError(problem instanceof Error?`操作失败 Operation failed: ${problem.message}`:'操作未完成，请重试。 The action could not be completed. Please retry.')}
    finally{setBusy(false)}
  }

  function openPayment(statement:WageStatementRecord,full:boolean){
    const amount=full?money(statement.wageCents-statement.paidCents):'',date=malaysiaDateKey()
    setPaymentStatement(statement)
    setPaymentAmount(amount)
    setPaymentMethod('cash')
    setPaymentDate(date)
    setReference('')
    setNote('')
    setPaymentBaseline(JSON.stringify([amount,'cash',date,'','']))
  }

  async function submitPayment(event:FormEvent){
    event.preventDefault()
    if(!paymentStatement)return
    const amountCents=rmStringToCents(paymentAmount)
    await perform(async()=>{
      await onPayment({monthKey,statementId:paymentStatement.id,amountCents,method:paymentMethod,paymentDate,reference,note})
      setPaymentStatement(null)
    })
  }

  return <section className="month-closing" aria-label="结月管理 Wage month closing">
    <div className="month-closing-heading">
      <div>
        <p className="eyebrow">结月管理 Month status</p>
        <strong className={`month-status ${closed?'closed':'open'}`}>{closed?'已结月 Closed':'未结月 Open'}</strong>
      </div>
      {closed&&<div className="close-meta">
        <span>版本 Version {data.month!.closeVersion}</span>
        <small>结月时间 Closed {timestampLabel(data.month!.closedAt)}</small>
      </div>}
    </div>

    {error&&<p className="error" role="alert">{error}</p>}

    {!closed&&<>
      <p className="notice">本月未结月，汇总使用当前工钱记录。 This month uses live wage records until it is closed.</p>
      <button className="close-month-action" type="button" disabled={busy||liveEntries.length===0} onClick={()=>setConfirmClose(true)}>结月 Close Month</button>
      {liveEntries.length===0&&<p className="notice">本月没有工钱记录，不能结月。 A month with no wage records cannot be closed.</p>}
      {confirmClose&&<div className="confirm-panel" role="dialog" aria-label="Confirm Close Month">
        <h2>确认结月 Close {monthLabel(monthKey)}?</h2>
        <div className="confirm-totals">
          <div><span>工人数 Workers</span><strong>{liveTotals.workers}</strong></div>
          <div><span>总篮数 Baskets</span><strong>{liveTotals.baskets}</strong></div>
          <div><span>总重量 Total kg</span><strong>{liveTotals.weight}kg</strong></div>
          <div><span>总工钱 Total wage</span><strong>RM{money(liveTotals.wageCents)}</strong></div>
        </div>
        <p>结月会保存永久版本快照，并锁定本月新增及作废操作。 Closing creates permanent versioned worker snapshots and prevents new entries or voids for this month.</p>
        <button type="button" disabled={busy} onClick={()=>void perform(async()=>{await onClose(monthKey);setConfirmClose(false)})}>确认结月 Confirm Close Month</button>
        <button className="secondary-action" type="button" disabled={busy} onClick={()=>setConfirmClose(false)}>取消 Cancel</button>
      </div>}
    </>}

    {closed&&<>
      <div className="closed-totals">
        <div><span>工人数 Workers</span><strong>{data.month!.workerCount}</strong></div>
        <div><span>总篮数 Baskets</span><strong>{data.month!.basketCount}</strong></div>
        <div><span>总重量 Total kg</span><strong>{data.month!.totalWeightKg}kg</strong></div>
        <div><span>总工钱 Gross wage</span><strong>RM{money(data.month!.totalWageCents)}</strong></div>
        {showPaymentTracking&&<><div><span>Paid total</span><strong>RM{money(data.month!.paidCents)}</strong></div>
        <div><span>Outstanding</span><strong>RM{money(data.month!.totalWageCents-data.month!.paidCents)}</strong></div></>}
      </div>
      {showPaymentTracking&&<>
      <div className="statement-list">
        {data.statements.map(statement=>{
          const status=paymentStatus(statement.paidCents,statement.wageCents)
          const balance=statement.wageCents-statement.paidCents
          return <section className="statement-card" key={statement.id}>
            <div className="statement-heading">
              <h2>{statement.workerName}</h2>
              <strong className={`payment-status ${status}`}>{status[0].toUpperCase()+status.slice(1)}</strong>
            </div>
            <div className="statement-totals">
              <div><span>总工钱 Gross wage</span><strong>RM{money(statement.wageCents)}</strong></div>
              <div><span>Paid</span><strong>RM{money(statement.paidCents)}</strong></div>
              <div><span>Balance</span><strong>RM{money(balance)}</strong></div>
            </div>
            <Link className="statement-link" to={`/monthly/${monthKey}/worker/${statement.workerId}/statement`}>View statement & payments</Link>
            {balance>0&&<div className="payment-actions">
              <button type="button" disabled={busy} onClick={()=>openPayment(statement,true)}>Mark Paid in Full</button>
              <button type="button" disabled={busy} onClick={()=>openPayment(statement,false)}>Add Partial Payment</button>
            </div>}
          </section>
        })}
      </div>

      {paymentStatement&&<form className="action-form" aria-label={`Payment for ${paymentStatement.workerName}`} onSubmit={event=>void submitPayment(event)}>
        <h2>Payment for {paymentStatement.workerName}</h2>
        <label>Amount (RM)<input required inputMode="decimal" min="0.01" max={money(paymentStatement.wageCents-paymentStatement.paidCents)} value={paymentAmount} onChange={event=>setPaymentAmount(event.target.value)}/></label>
        <label>Payment method<select value={paymentMethod} onChange={event=>setPaymentMethod(event.target.value as CreatePaymentInput['method'])}>
          <option value="cash">Cash</option><option value="bank">Bank</option><option value="other">Other</option>
        </select></label>
        <label>Payment date<input required type="date" value={paymentDate} onChange={event=>setPaymentDate(event.target.value)}/></label>
        <label>Reference (optional)<input maxLength={100} value={reference} onChange={event=>setReference(event.target.value)}/></label>
        <label>Note (optional)<input maxLength={500} value={note} onChange={event=>setNote(event.target.value)}/></label>
        <button type="submit" disabled={busy}>Save payment</button>
        <button className="secondary-action" type="button" onClick={()=>setPaymentStatement(null)}>取消 Cancel</button>
      </form>}

      <details className="payment-history">
        <summary>View payment records ({data.payments.length})</summary>
        {data.payments.length===0?<p className="notice">No payments recorded.</p>:
          <ul>{data.payments.map(payment=><li key={payment.id}>
            <div><strong>{payment.workerName}</strong><span>RM{money(payment.amountCents)} · {payment.method} · {payment.paymentDate}</span></div>
            {payment.voided?<strong className="payment-voided">Voided: {payment.voidReason}</strong>:
              <button type="button" onClick={()=>setVoidPayment(payment)}>Void payment</button>}
          </li>)}</ul>}
      </details>

      {voidPayment&&<form className="action-form" aria-label="Void payment" onSubmit={event=>{
        event.preventDefault()
        void perform(async()=>{await onVoidPayment(monthKey,voidPayment.id,voidReason);setVoidPayment(null);setVoidReason('')})
      }}>
        <h2>Void RM{money(voidPayment.amountCents)} payment?</h2>
        <label>原因 Reason<input required minLength={3} maxLength={100} value={voidReason} onChange={event=>setVoidReason(event.target.value)}/></label>
        <button type="submit" disabled={busy}>Confirm void</button>
        <button className="secondary-action" type="button" onClick={()=>setVoidPayment(null)}>取消 Cancel</button>
      </form>}

      </>}
      <button className="reopen-action" type="button" disabled={busy||data.month!.paidCents>0} onClick={()=>setShowReopen(true)}>重新开月 Reopen Month</button>
      {data.month!.paidCents>0&&<p className="warning">{showPaymentTracking?'Void all valid payments before reopening this month.':'历史记录限制重新开月，请联系管理员核对。 Legacy records prevent reopening; contact the administrator.'}</p>}
      {showReopen&&<form className="action-form" aria-label="Reopen month" onSubmit={event=>{
        event.preventDefault()
        void perform(async()=>{await onReopen(monthKey,reopenReason);setShowReopen(false);setReopenReason('')})
      }}>
        <h2>重新开月 Reopen {monthLabel(monthKey)}?</h2>
        <label>原因 Reason<input required minLength={3} maxLength={100} value={reopenReason} onChange={event=>setReopenReason(event.target.value)}/></label>
        <button type="submit" disabled={busy}>确认重新开月 Confirm Reopen Month</button>
        <button className="secondary-action" type="button" onClick={()=>setShowReopen(false)}>取消 Cancel</button>
      </form>}
    </>}
  </section>
}
