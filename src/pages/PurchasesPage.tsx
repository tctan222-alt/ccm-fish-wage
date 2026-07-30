import { useEffect,useMemo,useState } from 'react'
import { Link } from 'react-router-dom'
import type { PurchaseReceipt } from '../lib/purchasing'
import { loadPurchaseReceipts } from '../services/purchases'

export function PurchasesPage({loader=loadPurchaseReceipts}:{loader?:()=>Promise<PurchaseReceipt[]>}){
  const [items,setItems]=useState<PurchaseReceipt[]|null>(null);const [search,setSearch]=useState('');const [status,setStatus]=useState('all')
  const [date,setDate]=useState('');const [supplier,setSupplier]=useState('');const [vessel,setVessel]=useState('');const [error,setError]=useState('')
  useEffect(()=>{loader().then(setItems).catch(()=>{setItems([]);setError('Purchase receipts could not be loaded.')})},[loader])
  const visible=useMemo(()=>(items??[]).filter(item=>{
    const statusMatch=status==='all'||item.status===status
      ||(['unpaid','partial','paid'].includes(status)&&item.status==='confirmed'&&item.paymentStatus===status)
    const text=[item.receiptCode,item.externalSlipNo,item.supplierNameSnapshot,item.vesselNameSnapshot,item.vesselCodeSnapshot].join(' ').toLocaleLowerCase()
    return statusMatch&&(!date||item.receiptDate===date)&&(!supplier||item.supplierId===supplier)&&(!vessel||item.vesselId===vessel)&&text.includes(search.trim().toLocaleLowerCase())
  }),[items,search,status,date,supplier,vessel])
  const confirmed=visible.filter(item=>item.status==='confirmed')
  const suppliers=Array.from(new Map((items??[]).map(item=>[item.supplierId,item.supplierNameSnapshot])).entries())
  const vessels=Array.from(new Map((items??[]).map(item=>[item.vesselId,item.vesselNameSnapshot||item.vesselCodeSnapshot])).entries())
  const totals={kg:confirmed.reduce((sum,item)=>sum+item.totalWeightGrams,0)/1000,amount:confirmed.reduce((sum,item)=>sum+item.totalAmountCents,0),outstanding:confirmed.reduce((sum,item)=>sum+item.totalAmountCents-item.paidCents,0)}
  return <main><header><p className="eyebrow">CCM Fishery</p><h1>Purchases & Receiving</h1><Link className="page-link" to="/">← Wage entry</Link></header>
    <nav className="summary-nav"><Link className="summary-link" to="/purchases/monthly">Supplier monthly</Link><Link className="summary-link monthly" to="/master-data">Master Data</Link></nav>
    <Link className="primary-action purchase-new-link" to="/purchases/new">New Purchase Receipt</Link>
    <section className="purchase-filters"><label>Date<input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label>
      <label>Supplier<select value={supplier} onChange={e=>setSupplier(e.target.value)}><option value="">All</option>{suppliers.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
      <label>Vessel<select value={vessel} onChange={e=>setVessel(e.target.value)}><option value="">All</option>{vessels.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
      <label>Status<select value={status} onChange={e=>setStatus(e.target.value)}><option value="all">All</option><option value="draft">Draft</option><option value="confirmed">Confirmed</option><option value="voided">Voided</option><option value="unpaid">Unpaid</option><option value="partial">Partial</option><option value="paid">Paid</option></select></label>
      <label className="purchase-search">Search<input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Receipt, slip, supplier or vessel"/></label></section>
    <section className="master-summary purchase-summary"><div><span>Receipts</span><strong>{visible.length}</strong></div><div><span>Total kg</span><strong>{totals.kg.toFixed(3)}</strong></div><div><span>Amount</span><strong>RM {(totals.amount/100).toFixed(2)}</strong></div><div><span>Outstanding</span><strong>RM {(totals.outstanding/100).toFixed(2)}</strong></div></section>
    {error&&<p className="error" role="alert">{error}</p>}
    {items===null?<p className="notice">Loading receipts…</p>:<div className="receipt-list">{visible.map(item=><Link className="receipt-card" to={`/purchases/${item.id}`} key={item.id}>
      <div><small>{item.receiptDate} · {item.externalSlipNo||'No external slip'}</small><strong>{item.receiptCode}</strong><span>{item.supplierNameSnapshot} · {item.vesselNameSnapshot||item.vesselCodeSnapshot}</span></div>
      <div><span className={`record-status ${item.status}`}>{item.status}</span><span className={`payment-status ${item.paymentStatus}`}>{item.paymentStatus}</span><strong>RM {(item.totalAmountCents/100).toFixed(2)}</strong></div>
    </Link>)}</div>}
  </main>
}
