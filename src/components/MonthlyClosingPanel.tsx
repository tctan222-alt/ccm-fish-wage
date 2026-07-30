import { useMemo,useState,type FormEvent } from 'react'
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

export function MonthlyClosingPanel({monthKey,liveEntries,data,onClose,onPayment,onVoidPayment,onReopen}:Props){
  const [confirmClose,setConfirmClose]=useState(false)
  const [paymentStatement,setPaymentStatement]=useState<WageStatementRecord|null>(null)
  const [paymentAmount,setPaymentAmount]=useState('')
  const [paymentMethod,setPaymentMethod]=useState<CreatePaymentInput['method']>('cash')
  const [paymentDate,setPaymentDate]=useState(()=>malaysiaDateKey())
  const [reference,setReference]=useState('')
  const [note,setNote]=useState('')
  const [voidPayment,setVoidPayment]=useState<WagePaymentRecord|null>(null)
  const [voidReason,setVoidReason]=useState('')
  const [showReopen,setShowReopen]=useState(false)
  const [reopenReason,setReopenReason]=useState('')
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')

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
    catch(problem){setError(problem instanceof Error?problem.message:'The action could not be completed')}
    finally{setBusy(false)}
  }

  function openPayment(statement:WageStatementRecord,full:boolean){
    setPaymentStatement(statement)
    setPaymentAmount(full?money(statement.wageCents-statement.paidCents):'')
    setPaymentMethod('cash')
    setPaymentDate(malaysiaDateKey())
    setReference('')
    setNote('')
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

  return <section className="month-closing" aria-label="Wage month closing">
    <div className="month-closing-heading">
      <div>
        <p className="eyebrow">Month status</p>
        <strong className={`month-status ${closed?'closed':'open'}`}>{closed?'Closed':'Open'}</strong>
      </div>
      {closed&&<div className="close-meta">
        <span>Version {data.month!.closeVersion}</span>
        <small>Closed {timestampLabel(data.month!.closedAt)}</small>
      </div>}
    </div>

    {error&&<p className="error" role="alert">{error}</p>}

    {!closed&&<>
      <p className="notice">This month uses live wage records until it is closed.</p>
      <button className="close-month-action" type="button" disabled={busy||liveEntries.length===0} onClick={()=>setConfirmClose(true)}>Close Month</button>
      {liveEntries.length===0&&<p className="notice">A month with no wage records cannot be closed.</p>}
      {confirmClose&&<div className="confirm-panel" role="dialog" aria-label="Confirm Close Month">
        <h2>Close {monthLabel(monthKey)}?</h2>
        <div className="confirm-totals">
          <div><span>Workers</span><strong>{liveTotals.workers}</strong></div>
          <div><span>Baskets</span><strong>{liveTotals.baskets}</strong></div>
          <div><span>Total kg</span><strong>{liveTotals.weight}kg</strong></div>
          <div><span>Total wage</span><strong>RM{money(liveTotals.wageCents)}</strong></div>
        </div>
        <p>Closing creates permanent versioned worker snapshots and prevents new entries or voids for this month.</p>
        <button type="button" disabled={busy} onClick={()=>void perform(async()=>{await onClose(monthKey);setConfirmClose(false)})}>Confirm Close Month</button>
        <button className="secondary-action" type="button" disabled={busy} onClick={()=>setConfirmClose(false)}>Cancel</button>
      </div>}
    </>}

    {closed&&<>
      <div className="closed-totals">
        <div><span>Workers</span><strong>{data.month!.workerCount}</strong></div>
        <div><span>Baskets</span><strong>{data.month!.basketCount}</strong></div>
        <div><span>Total kg</span><strong>{data.month!.totalWeightKg}kg</strong></div>
        <div><span>Gross wage</span><strong>RM{money(data.month!.totalWageCents)}</strong></div>
        <div><span>Paid total</span><strong>RM{money(data.month!.paidCents)}</strong></div>
        <div><span>Outstanding</span><strong>RM{money(data.month!.totalWageCents-data.month!.paidCents)}</strong></div>
      </div>
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
              <div><span>Gross wage</span><strong>RM{money(statement.wageCents)}</strong></div>
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
        <button className="secondary-action" type="button" onClick={()=>setPaymentStatement(null)}>Cancel</button>
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
        <label>Reason<input required minLength={3} maxLength={100} value={voidReason} onChange={event=>setVoidReason(event.target.value)}/></label>
        <button type="submit" disabled={busy}>Confirm void</button>
        <button className="secondary-action" type="button" onClick={()=>setVoidPayment(null)}>Cancel</button>
      </form>}

      <button className="reopen-action" type="button" disabled={busy||data.month!.paidCents>0} onClick={()=>setShowReopen(true)}>Reopen Month</button>
      {data.month!.paidCents>0&&<p className="warning">Void all valid payments before reopening this month.</p>}
      {showReopen&&<form className="action-form" aria-label="Reopen month" onSubmit={event=>{
        event.preventDefault()
        void perform(async()=>{await onReopen(monthKey,reopenReason);setShowReopen(false);setReopenReason('')})
      }}>
        <h2>Reopen {monthLabel(monthKey)}?</h2>
        <label>Reason<input required minLength={3} maxLength={100} value={reopenReason} onChange={event=>setReopenReason(event.target.value)}/></label>
        <button type="submit" disabled={busy}>Confirm Reopen Month</button>
        <button className="secondary-action" type="button" onClick={()=>setShowReopen(false)}>Cancel</button>
      </form>}
    </>}
  </section>
}
