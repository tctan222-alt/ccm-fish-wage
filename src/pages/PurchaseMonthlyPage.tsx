import { useEffect,useMemo,useState,type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import type { BusinessPartner } from '../lib/masterData'
import { supplierMonthlySummary,type PaymentMethod,type PurchaseReceipt } from '../lib/purchasing'
import { loadBusinessPartners } from '../services/businessPartners'
import { createPurchasePayment,loadPurchaseReceipts,paySelectedReceipts } from '../services/purchases'

const currentMonth=()=>new Date().toISOString().slice(0,7)
const today=()=>new Date().toISOString().slice(0,10)
interface Props {receiptLoader?:()=>Promise<PurchaseReceipt[]>;supplierLoader?:()=>Promise<BusinessPartner[]>;
  payer?:typeof createPurchasePayment;selectedPayer?:typeof paySelectedReceipts;printer?:()=>void}
const loadMonthlySuppliers=async()=>(await loadBusinessPartners()).filter(item=>item.supplier)
export function PurchaseMonthlyPage({receiptLoader=loadPurchaseReceipts,supplierLoader=loadMonthlySuppliers,payer=createPurchasePayment,
  selectedPayer=paySelectedReceipts,printer=()=>window.print()}:Props){
  const [receipts,setReceipts]=useState<PurchaseReceipt[]>([]);const [suppliers,setSuppliers]=useState<BusinessPartner[]>([])
  const [month,setMonth]=useState(currentMonth());const [supplierId,setSupplierId]=useState('');const [selected,setSelected]=useState<string[]>([])
  const [paying,setPaying]=useState<PurchaseReceipt|null|'selected'>(null);const [error,setError]=useState('');const [loading,setLoading]=useState(true)
  useEffect(()=>{void Promise.all([receiptLoader(),supplierLoader()]).then(([rows,partners])=>{setReceipts(rows);setSuppliers(partners);setSupplierId(partners[0]?.id??'')}).catch(()=>setError('Supplier monthly data could not be loaded.')).finally(()=>setLoading(false))},[receiptLoader,supplierLoader])
  const summary=useMemo(()=>supplierMonthlySummary(receipts,month,supplierId),[receipts,month,supplierId])
  const supplier=suppliers.find(item=>item.id===supplierId)
  function refreshPaid(ids:string[]){setReceipts(rows=>rows.map(row=>ids.includes(row.id)?{...row,paidCents:row.totalAmountCents,paymentStatus:'paid'}:row));setSelected([]);setPaying(null)}
  return <main className="statement-page"><header className="statement-navigation"><p className="eyebrow">CCM Fishery</p><h1>Supplier Monthly</h1><Link className="page-link" to="/purchases">← Purchases</Link></header>
    <section className="purchase-month-controls statement-navigation"><label>Month<input type="month" value={month} onChange={e=>setMonth(e.target.value)}/></label>
      <label>Supplier<select value={supplierId} onChange={e=>{setSupplierId(e.target.value);setSelected([])}}><option value="">Select Supplier</option>{suppliers.map(item=><option key={item.id} value={item.id}>{item.displayName}</option>)}</select></label>
      <button className="print-action" onClick={printer}>Print Supplier Statement</button></section>
    {error&&<p className="error" role="alert">{error}</p>}{loading&&<p className="notice">Loading monthly purchases…</p>}
    <section className="print-statement"><p className="statement-print-brand">CCM Fishery</p><div className="statement-title"><div><span>Supplier</span><strong>{supplier?.displayName||'—'}</strong></div><div><span>Month</span><strong>{month}</strong></div></div>
      <section className="master-summary purchase-summary"><div><span>Confirmed</span><strong>{summary.receiptCount}</strong></div><div><span>Total kg</span><strong>{(summary.totalWeightGrams/1000).toFixed(3)}</strong></div><div><span>Gross</span><strong>RM {(summary.grossCents/100).toFixed(2)}</strong></div><div><span>Paid</span><strong>RM {(summary.paidCents/100).toFixed(2)}</strong></div><div><span>Outstanding</span><strong>RM {(summary.outstandingCents/100).toFixed(2)}</strong></div></section>
      <div className="monthly-receipt-list">{summary.receipts.map(item=>{const balance=item.totalAmountCents-item.paidCents;return <article className="monthly-receipt" key={item.id}>
        <label className="statement-navigation check-label"><input type="checkbox" disabled={balance<=0} checked={selected.includes(item.id)} onChange={e=>setSelected(ids=>e.target.checked?[...ids,item.id]:ids.filter(id=>id!==item.id))}/> Select</label>
        <div><small>{item.receiptDate} · {item.externalSlipNo||'—'}</small><strong>{item.receiptCode}</strong><span>{item.vesselNameSnapshot||item.vesselCodeSnapshot}</span></div>
        <dl><div><dt>Amount</dt><dd>RM {(item.totalAmountCents/100).toFixed(2)}</dd></div><div><dt>Paid</dt><dd>RM {(item.paidCents/100).toFixed(2)}</dd></div><div><dt>Balance</dt><dd>RM {(balance/100).toFixed(2)}</dd></div><div><dt>Status</dt><dd>{item.paymentStatus}</dd></div></dl>
        {balance>0&&<button className="statement-navigation" onClick={()=>setPaying(item)}>Pay / Mark Paid</button>}</article>})}</div>
      <p className="printed-at">Printed: {new Date().toLocaleString()}</p></section>
    {selected.length>0&&<button className="primary-action statement-navigation pay-selected" onClick={()=>setPaying('selected')}>Pay Selected ({selected.length})</button>}
    {paying&&<PaymentDialog receipt={paying==='selected'?null:paying} save={async input=>{if(paying==='selected'){const chosen=summary.receipts.filter(item=>selected.includes(item.id));await selectedPayer(chosen,input);refreshPaid(selected)}
      else{await payer(paying,{...input,amountCents:input.amountCents??paying.totalAmountCents-paying.paidCents});const newPaid=paying.paidCents+(input.amountCents??paying.totalAmountCents-paying.paidCents);setReceipts(rows=>rows.map(row=>row.id===paying.id?{...row,paidCents:newPaid,paymentStatus:newPaid===row.totalAmountCents?'paid':'partial'}:row));setPaying(null)}}} close={()=>setPaying(null)}/>}
  </main>
}
type PayForm={amountCents?:number;method:PaymentMethod;paymentDate:string;reference:string;note:string}
function PaymentDialog({receipt,save,close}:{receipt:PurchaseReceipt|null;save:(value:PayForm)=>Promise<void>;close:()=>void}){
  const balance=receipt?receipt.totalAmountCents-receipt.paidCents:0
  const [amount,setAmount]=useState(receipt?(balance/100).toFixed(2):'');const [method,setMethod]=useState<PaymentMethod>('bank')
  const [paymentDate,setPaymentDate]=useState(today());const [reference,setReference]=useState('');const [note,setNote]=useState('');const [error,setError]=useState('');const [busy,setBusy]=useState(false)
  async function submit(e:FormEvent){e.preventDefault();const amountCents=receipt?Math.round(Number(amount)*100):undefined
    if(receipt&&(!amountCents||amountCents>balance)){setError('Enter a payment within the receipt balance.');return}
    setBusy(true);try{await save({amountCents,method,paymentDate,reference,note})}catch(problem){setError(problem instanceof Error?problem.message:'Payment was not saved.')}finally{setBusy(false)}}
  return <div className="dialog-backdrop"><section className="form-dialog" role="dialog" aria-modal="true"><h2>{receipt?`Pay ${receipt.receiptCode}`:'Pay Selected Receipts'}</h2>
    <form className="master-form" onSubmit={submit}>{receipt&&<label>Amount RM<input inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)}/></label>}
      {!receipt&&<p>Each selected receipt will be paid to its full outstanding balance under one payment group.</p>}
      <label>Payment date<input type="date" value={paymentDate} onChange={e=>setPaymentDate(e.target.value)}/></label><label>Method<select value={method} onChange={e=>setMethod(e.target.value as PaymentMethod)}><option value="cash">Cash</option><option value="bank">Bank</option><option value="other">Other</option></select></label>
      <label>Reference<input value={reference} maxLength={100} onChange={e=>setReference(e.target.value)}/></label><label>Note<textarea value={note} maxLength={500} onChange={e=>setNote(e.target.value)}/></label>
      {error&&<p className="error" role="alert">{error}</p>}<button className="primary-action" disabled={busy}>{busy?'Saving…':'Save Payment'}</button><button type="button" disabled={busy} onClick={close}>Cancel</button></form></section></div>
}
