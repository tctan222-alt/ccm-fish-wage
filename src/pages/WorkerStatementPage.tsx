import { useEffect,useMemo,useState } from 'react'
import { Link,useParams } from 'react-router-dom'
import { money } from '../lib/wage'
import { loadWageMonthClosingData,type WageMonthClosingData } from '../services/monthClosing'

interface Props {
  loader?:(monthKey:string)=>Promise<WageMonthClosingData>
}

function monthLabel(monthKey:string){
  return new Intl.DateTimeFormat('en-MY',{month:'long',year:'numeric',timeZone:'Asia/Kuala_Lumpur'})
    .format(new Date(`${monthKey}-01T12:00:00+08:00`))
}

export function WorkerStatementPage({loader=loadWageMonthClosingData}:Props){
  const {monthKey='',workerId=''}=useParams()
  const [data,setData]=useState<WageMonthClosingData|null>(null)
  const [error,setError]=useState('')

  useEffect(()=>{
    let active=true
    loader(monthKey).then(result=>{if(active)setData(result)}).catch(()=>{if(active)setError('Statement could not be loaded')})
    return()=>{active=false}
  },[loader,monthKey])

  const statement=data?.statements.find(item=>item.workerId===workerId)
  const payments=useMemo(()=>data?.payments.filter(item=>item.workerId===workerId)??[],[data,workerId])

  if(error)return <main><p className="error" role="alert">{error}</p><Link className="page-link" to="/monthly">Back to monthly summary</Link></main>
  if(!data)return <main className="loading-screen" role="status"><strong>Loading statement…</strong></main>
  if(!data.month||data.month.status!=='closed'||!statement)return <main><p className="notice">No current closed statement was found.</p><Link className="page-link" to="/monthly">Back to monthly summary</Link></main>

  return <main className="statement-page">
    <header className="statement-navigation">
      <p className="eyebrow">CCM Fishery</p>
      <h1>Worker Month Statement</h1>
      <Link className="page-link" to="/monthly">Back to monthly summary</Link>
    </header>

    <section className="print-statement">
      <p className="statement-print-brand">CCM Fishery</p>
      <div className="statement-title">
        <div><span>Month</span><strong>{monthLabel(monthKey)}</strong></div>
        <div><span>Worker</span><strong>{statement.workerName}</strong></div>
        <div><span>Close version</span><strong>{statement.closeVersion}</strong></div>
      </div>

      <div className="statement-totals">
        <div><span>Baskets</span><strong>{statement.basketCount}</strong></div>
        <div><span>Total kg</span><strong>{statement.totalWeightKg}kg</strong></div>
      </div>

      <h2>Rate breakdown</h2>
      <div className="statement-rate-breakdown">
        <div><span>RM0.12</span><strong>RM{money(statement.rateBreakdown.rate12Cents)}</strong></div>
        <div><span>RM0.15</span><strong>RM{money(statement.rateBreakdown.rate15Cents)}</strong></div>
        <div><span>RM0.18</span><strong>RM{money(statement.rateBreakdown.rate18Cents)}</strong></div>
        <div><span>Custom</span><strong>RM{money(statement.rateBreakdown.customCents)}</strong></div>
      </div>

      <div className="statement-balance">
        <div><span>Gross wage</span><strong>RM{money(statement.wageCents)}</strong></div>
        <div><span>Paid</span><strong>RM{money(statement.paidCents)}</strong></div>
        <div><span>Balance</span><strong>RM{money(statement.wageCents-statement.paidCents)}</strong></div>
      </div>

      <h2>Payment history</h2>
      {payments.length===0?<p>No payments recorded.</p>:<table>
        <thead><tr><th>Date</th><th>Method</th><th>Reference</th><th>Amount</th><th>Status</th></tr></thead>
        <tbody>{payments.map(payment=><tr key={payment.id}>
          <td>{payment.paymentDate}</td><td>{payment.method}</td><td>{payment.reference||'—'}</td>
          <td>RM{money(payment.amountCents)}</td><td>{payment.voided?'Voided':'Valid'}</td>
        </tr>)}</tbody>
      </table>}
      <p className="printed-at">Printed {new Intl.DateTimeFormat('en-MY',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Kuala_Lumpur'}).format(new Date())}</p>
    </section>

    <button className="print-action" type="button" onClick={()=>window.print()}>Print / Save PDF</button>
  </main>
}
