import { useEffect,useMemo,useRef,useState,type FormEvent } from 'react'
import { Link,useNavigate,useParams } from 'react-router-dom'
import { BusinessPartnerFormDialog } from '../components/BusinessPartnerFormDialog'
import type { BusinessPartner,BusinessPartnerInput } from '../lib/masterData'
import {
  activePurchaseCategories,activeVessels,calculateReceiptTotals,duplicateExternalSlip,duplicateVesselCode,kgInputToGrams,
  lineAmountCents,rmInputToCentsPerKg,voidPurchasePayment,type PurchaseCategory,type PurchaseCategoryInput,type PurchasePayment,
  type PurchaseReceipt,type PurchaseReceiptLine,type Vessel,type VesselInput,
} from '../lib/purchasing'
import { createBusinessPartner,loadActiveSuppliers } from '../services/businessPartners'
import { createPurchaseCategory,createVessel,loadPurchaseCategories,loadVessels } from '../services/purchaseMasterData'
import { confirmPurchaseReceipt,loadPurchasePayments,loadPurchaseReceipt,loadPurchaseReceipts,saveDraftReceipt,
  voidPurchasePaymentRecord,voidPurchaseReceiptRecord } from '../services/purchases'

const today=()=>new Date().toISOString().slice(0,10)
const emptyReceipt=():PurchaseReceipt=>({id:'',receiptCode:'New',receiptDate:today(),monthKey:today().slice(0,7),externalSlipNo:'',
  supplierId:'',supplierCodeSnapshot:'',supplierNameSnapshot:'',vesselId:'',vesselCodeSnapshot:'',vesselNameSnapshot:'',status:'draft',
  lineCount:0,totalBasketCount:0,totalWeightGrams:0,totalAmountCents:0,paidCents:0,paymentStatus:'unpaid',notes:'',duplicateAcknowledged:false,lines:[]})
type NewLine={categoryId:string;basketCount:string;kg:string;price:string;notes:string}
const newLine=():NewLine=>({categoryId:'',basketCount:'',kg:'',price:'',notes:''})
interface Props {
  receiptLoader?:(id:string)=>Promise<PurchaseReceipt>;receiptsLoader?:()=>Promise<PurchaseReceipt[]>;supplierLoader?:()=>Promise<BusinessPartner[]>;
  vesselLoader?:()=>Promise<Vessel[]>;categoryLoader?:()=>Promise<PurchaseCategory[]>;draftSaver?:(value:PurchaseReceipt)=>Promise<PurchaseReceipt>;
  confirmer?:(value:PurchaseReceipt)=>Promise<PurchaseReceipt>;voider?:(value:PurchaseReceipt,reason:string)=>Promise<PurchaseReceipt>;
  supplierCreator?:(input:BusinessPartnerInput)=>Promise<BusinessPartner>;vesselCreator?:(input:VesselInput)=>Promise<Vessel>;
  categoryCreator?:(input:PurchaseCategoryInput)=>Promise<PurchaseCategory>;paymentLoader?:(receiptId:string)=>Promise<PurchasePayment[]>;
  paymentVoider?:(payment:PurchasePayment,receipt:PurchaseReceipt,reason:string)=>Promise<void>
}
export function PurchaseReceiptPage({receiptLoader=loadPurchaseReceipt,receiptsLoader=loadPurchaseReceipts,supplierLoader=loadActiveSuppliers,
  vesselLoader=loadVessels,categoryLoader=loadPurchaseCategories,draftSaver=saveDraftReceipt,confirmer=confirmPurchaseReceipt,voider=voidPurchaseReceiptRecord,
  supplierCreator=createBusinessPartner,vesselCreator=createVessel,categoryCreator=createPurchaseCategory,paymentLoader=loadPurchasePayments,
  paymentVoider=voidPurchasePaymentRecord}:Props){
  const {receiptId}=useParams();const navigate=useNavigate();const isNew=!receiptId||receiptId==='new'
  const [value,setValue]=useState<PurchaseReceipt>(emptyReceipt());const [allReceipts,setAllReceipts]=useState<PurchaseReceipt[]>([])
  const [suppliers,setSuppliers]=useState<BusinessPartner[]>([]);const [vessels,setVessels]=useState<Vessel[]>([]);const [categories,setCategories]=useState<PurchaseCategory[]>([])
  const [payments,setPayments]=useState<PurchasePayment[]>([])
  const [lineInputs,setLineInputs]=useState<NewLine[]>([newLine()]);const [quick,setQuick]=useState<''|'supplier'|'vessel'|'category'>('')
  const [quickCategoryLine,setQuickCategoryLine]=useState(0)
  const [error,setError]=useState('');const [busy,setBusy]=useState(false);const [confirming,setConfirming]=useState(false);const lock=useRef(false)
  useEffect(()=>{void Promise.all([isNew?Promise.resolve(emptyReceipt()):receiptLoader(receiptId!),receiptsLoader(),supplierLoader(),vesselLoader(),categoryLoader(),isNew?Promise.resolve([]):paymentLoader(receiptId!)])
    .then(([receipt,receipts,supplierRows,vesselRows,categoryRows,paymentRows])=>{setValue(receipt);setAllReceipts(receipts);setSuppliers(supplierRows);setVessels(vesselRows);setCategories(categoryRows);setPayments(paymentRows)
      if(receipt.lines.length)setLineInputs(receipt.lines.map(line=>({categoryId:line.categoryId,basketCount:String(line.basketCount||''),kg:(line.weightGrams/1000).toFixed(3).replace(/\.?0+$/,''),price:(line.unitPriceCentsPerKg/100).toFixed(2),notes:line.notes})))})
    .catch(()=>setError('Receipt data could not be loaded.'))},[isNew,receiptId,receiptLoader,receiptsLoader,supplierLoader,vesselLoader,categoryLoader,paymentLoader])
  const activeCategories=activePurchaseCategories(categories),activeVesselRows=activeVessels(vessels)
  const parsedLineRows=useMemo(()=>lineInputs.map((row,index)=>{
    const category=categories.find(item=>item.id===row.categoryId);if(!category||!row.kg||!row.price)return null
    try{const weightGrams=kgInputToGrams(row.kg),unitPriceCentsPerKg=rmInputToCentsPerKg(row.price),basketCount=row.basketCount===''?0:Number(row.basketCount)
      if(!Number.isInteger(basketCount)||basketCount<0||basketCount>9999)return null
      return {id:value.lines[index]?.id??'',lineNo:index+1,categoryId:category.id,categoryCodeSnapshot:category.categoryCode,categoryNameSnapshot:category.displayName,
        basketCount,weightGrams,unitPriceCentsPerKg,amountCents:lineAmountCents(weightGrams,unitPriceCentsPerKg),notes:row.notes} as PurchaseReceiptLine
    }catch{return null}
  }),[lineInputs,categories,value.lines])
  const parsedLines=useMemo(()=>parsedLineRows.filter((row):row is PurchaseReceiptLine=>Boolean(row)),[parsedLineRows])
  const totals=calculateReceiptTotals(parsedLines)
  function selectSupplier(id:string){const item=suppliers.find(row=>row.id===id);setValue(current=>({...current,supplierId:id,supplierCodeSnapshot:item?.partnerCode??'',supplierNameSnapshot:item?.displayName??''}))}
  function selectVessel(id:string){const item=vessels.find(row=>row.id===id);setValue(current=>({...current,vesselId:id,vesselCodeSnapshot:item?.vesselCode??'',vesselNameSnapshot:item?.displayName??'',
    ...(item?.defaultSupplierId&&!current.supplierId?{supplierId:item.defaultSupplierId,supplierNameSnapshot:item.defaultSupplierNameSnapshot,supplierCodeSnapshot:suppliers.find(row=>row.id===item.defaultSupplierId)?.partnerCode??''}:{})}))}
  async function persist(confirmAfter=false){
    if(lock.current)return;if(!value.supplierId||!value.vesselId){setError('Select a Supplier and Vessel.');return}
    if(parsedLines.length!==lineInputs.length||!parsedLines.length){setError('Complete at least one valid receipt line.');return}
    const duplicate=duplicateExternalSlip(value.externalSlipNo,allReceipts,value.id)
    if(duplicate&&!value.duplicateAcknowledged){setError('External slip number already exists. Confirm duplicate before saving.');return}
    lock.current=true;setBusy(true);setError('')
    try{const saved=await draftSaver({...value,...totals,lines:parsedLines});if(confirmAfter){const confirmed=await confirmer(saved);setValue(confirmed);setConfirming(false)}else{setValue(saved)}
      if(isNew&&!confirmAfter)navigate(`/purchases/${saved.id}`,{replace:true})}
    catch(problem){setError(problem instanceof Error?problem.message:'Receipt was not saved.')}finally{lock.current=false;setBusy(false)}
  }
  async function performVoid(){const reason=window.prompt('Void reason (3–100 characters)')??'';if(!reason)return
    setBusy(true);try{setValue(await voider(value,reason))}catch(problem){setError(problem instanceof Error?problem.message:'Receipt was not voided.')}finally{setBusy(false)}}
  async function performPaymentVoid(payment:PurchasePayment){const reason=window.prompt('Payment void reason (3–100 characters)')??'';if(!reason)return
    setBusy(true);try{await paymentVoider(payment,value,reason);setPayments(rows=>rows.map(row=>row.id===payment.id?{...row,voided:true,voidReason:reason}:row));setValue(current=>voidPurchasePayment(current,payment.amountCents))}
    catch(problem){setError(problem instanceof Error?problem.message:'Payment was not voided.')}finally{setBusy(false)}}
  const editable=value.status==='draft'
  return <main><header><p className="eyebrow">CCM Fishery</p><h1>{isNew?'New Purchase Receipt':value.receiptCode}</h1><Link className="page-link" to="/purchases">← Purchases</Link></header>
    <div className="receipt-status-row"><span className={`record-status ${value.status}`}>{value.status}</span><span className={`payment-status ${value.paymentStatus}`}>{value.paymentStatus}</span></div>
    {error&&<div className="error" role="alert">{error}{error.includes('Confirm duplicate')&&<button className="warning-action" onClick={()=>setValue({...value,duplicateAcknowledged:true})}>Confirm duplicate slip</button>}</div>}
    <section className="receipt-form"><label>Date<input disabled={!editable} type="date" value={value.receiptDate} onChange={e=>setValue({...value,receiptDate:e.target.value,monthKey:e.target.value.slice(0,7)})}/></label>
      <label>Supplier{editable?<select value={value.supplierId} onChange={e=>e.target.value==='__add'?setQuick('supplier'):selectSupplier(e.target.value)}><option value="">Select Supplier</option>{suppliers.map(item=><option key={item.id} value={item.id}>{item.displayName}</option>)}<option value="__add">+ Add Supplier</option></select>:<span className="snapshot-value">{value.supplierNameSnapshot}</span>}</label>
      <label>Vessel{editable?<select value={value.vesselId} onChange={e=>e.target.value==='__add'?setQuick('vessel'):selectVessel(e.target.value)}><option value="">Select Vessel</option>{activeVesselRows.map(item=><option key={item.id} value={item.id}>{item.vesselCode} · {item.displayName}</option>)}<option value="__add">+ Add Vessel</option></select>:<span className="snapshot-value">{value.vesselCodeSnapshot} · {value.vesselNameSnapshot}</span>}</label>
      <label>External Slip No.<input disabled={!editable} value={value.externalSlipNo} maxLength={100} onChange={e=>setValue({...value,externalSlipNo:e.target.value,duplicateAcknowledged:false})}/></label>
      <label className="wide">Notes<textarea disabled={!editable} value={value.notes} maxLength={500} onChange={e=>setValue({...value,notes:e.target.value})}/></label></section>
    <section className="receipt-lines"><h2>Receipt Lines</h2>{lineInputs.map((row,index)=><article className="receipt-line" key={index}><strong>Line {index+1}</strong>
      <label>Category{editable?<select value={row.categoryId} onChange={e=>{if(e.target.value==='__add'){setQuickCategoryLine(index);setQuick('category');return}setLineInputs(rows=>rows.map((item,i)=>i===index?{...item,categoryId:e.target.value}:item))}}><option value="">Select Category</option>{activeCategories.map(item=><option key={item.id} value={item.id}>{item.displayName}</option>)}<option value="__add">+ Add Category</option></select>:<span className="snapshot-value">{value.lines[index]?.categoryNameSnapshot}</span>}</label>
      <label>Baskets<input disabled={!editable} type="number" min="0" max="9999" inputMode="numeric" value={row.basketCount} onChange={e=>setLineInputs(rows=>rows.map((item,i)=>i===index?{...item,basketCount:e.target.value}:item))}/></label>
      <label>Weight kg<input disabled={!editable} inputMode="decimal" value={row.kg} onChange={e=>setLineInputs(rows=>rows.map((item,i)=>i===index?{...item,kg:e.target.value}:item))}/></label>
      <label>Price RM/kg<input disabled={!editable} inputMode="decimal" value={row.price} onChange={e=>setLineInputs(rows=>rows.map((item,i)=>i===index?{...item,price:e.target.value}:item))}/></label>
      <strong className="line-amount">RM {((parsedLineRows[index]?.amountCents??0)/100).toFixed(2)}</strong>
      {editable&&lineInputs.length>1&&<button className="danger-action" onClick={()=>setLineInputs(rows=>rows.filter((_,i)=>i!==index))}>Remove Line</button>}</article>)}
      {editable&&<button disabled={lineInputs.length>=100} onClick={()=>setLineInputs(rows=>[...rows,newLine()])}>Add Line</button>}</section>
    <section className="master-summary receipt-totals"><div><span>Lines</span><strong>{totals.lineCount}</strong></div><div><span>Baskets</span><strong>{totals.totalBasketCount}</strong></div><div><span>Total kg</span><strong>{(totals.totalWeightGrams/1000).toFixed(3)}</strong></div><div><span>Total</span><strong>RM {(totals.totalAmountCents/100).toFixed(2)}</strong></div></section>
    {editable&&<div className="receipt-actions"><button disabled={busy} className="secondary-action" onClick={()=>void persist(false)}>{busy?'Saving…':'Save Draft'}</button><button disabled={busy} className="primary-action" onClick={()=>setConfirming(true)}>Confirm Receipt</button></div>}
    {value.status==='confirmed'&&<button disabled={busy||value.paidCents>0} className="danger-action receipt-void" onClick={()=>void performVoid()}>Void Receipt</button>}
    {value.status==='confirmed'&&<details className="payment-history"><summary>Payment History ({payments.length})</summary><ul>{payments.map(payment=><li key={payment.id}>
      <div><strong>RM {(payment.amountCents/100).toFixed(2)} · {payment.method}</strong><span>{payment.paymentDate} {payment.reference}</span></div>
      {payment.voided?<strong className="payment-voided">Voided: {payment.voidReason}</strong>:<button disabled={busy} className="danger-action" onClick={()=>void performPaymentVoid(payment)}>Void Payment</button>}
    </li>)}</ul>{payments.length===0&&<p>No payments recorded.</p>}</details>}
    {confirming&&<div className="dialog-backdrop"><section className="form-dialog confirm-receipt" role="dialog" aria-modal="true"><h2>Confirm Receipt</h2><dl><div><dt>Supplier</dt><dd>{value.supplierNameSnapshot}</dd></div><div><dt>Vessel</dt><dd>{value.vesselNameSnapshot}</dd></div><div><dt>Slip</dt><dd>{value.externalSlipNo||'—'}</dd></div><div><dt>Lines / baskets</dt><dd>{totals.lineCount} / {totals.totalBasketCount}</dd></div><div><dt>Weight</dt><dd>{(totals.totalWeightGrams/1000).toFixed(3)} kg</dd></div><div><dt>Total</dt><dd>RM {(totals.totalAmountCents/100).toFixed(2)}</dd></div></dl>
      <button className="primary-action" disabled={busy} onClick={()=>void persist(true)}>Confirm now</button><button disabled={busy} onClick={()=>setConfirming(false)}>Cancel</button></section></div>}
    {quick==='supplier'&&<BusinessPartnerFormDialog partners={suppliers} defaultRole="supplier" save={supplierCreator} onClose={()=>setQuick('')} onSaved={(_,item)=>{setSuppliers(rows=>[...rows,item]);selectSupplierAfter(item);setQuick('')}}/>}
    {quick==='vessel'&&<QuickVessel suppliers={suppliers} existing={vessels} create={vesselCreator} saved={item=>{setVessels(rows=>[...rows,item]);setValue(current=>({...current,vesselId:item.id,vesselCodeSnapshot:item.vesselCode,vesselNameSnapshot:item.displayName}));setQuick('')}} close={()=>setQuick('')}/>}
    {quick==='category'&&<QuickCategory order={categories.length} create={categoryCreator} saved={item=>{setCategories(rows=>[...rows,item]);setLineInputs(rows=>rows.map((row,index)=>index===quickCategoryLine?{...row,categoryId:item.id}:row));setQuick('')}} close={()=>setQuick('')}/>}
  </main>
  function selectSupplierAfter(item:BusinessPartner){setValue(current=>({...current,supplierId:item.id,supplierCodeSnapshot:item.partnerCode,supplierNameSnapshot:item.displayName}))}
}
function QuickVessel({suppliers,existing,create,saved,close}:{suppliers:BusinessPartner[];existing:Vessel[];create:(input:VesselInput)=>Promise<Vessel>;saved:(item:Vessel)=>void;close:()=>void}){
  const [value,setValue]=useState<VesselInput>({vesselCode:'',displayName:'',defaultSupplierId:'',defaultSupplierNameSnapshot:'',notes:''});const [error,setError]=useState('');const [duplicateAcknowledged,setDuplicateAcknowledged]=useState(false);const [busy,setBusy]=useState(false);const lock=useRef(false)
  async function submit(e:FormEvent){e.preventDefault();if(!duplicateAcknowledged&&duplicateVesselCode(value.vesselCode,existing)){setError('A vessel with this code exists. Confirm these are different vessels.');return}if(lock.current)return;lock.current=true;setBusy(true);try{saved(await create(value))}catch(problem){setError(problem instanceof Error?problem.message:'Vessel was not saved.')}finally{lock.current=false;setBusy(false)}}
  return <div className="dialog-backdrop"><section className="form-dialog" role="dialog"><h2>Add Vessel</h2><form className="master-form" onSubmit={submit}><label>Vessel code<input value={value.vesselCode} onChange={e=>{setValue({...value,vesselCode:e.target.value});setDuplicateAcknowledged(false)}}/></label><label>Display name<input value={value.displayName} onChange={e=>setValue({...value,displayName:e.target.value})}/></label><label>Default supplier<select value={value.defaultSupplierId} onChange={e=>{const supplier=suppliers.find(row=>row.id===e.target.value);setValue({...value,defaultSupplierId:e.target.value,defaultSupplierNameSnapshot:supplier?.displayName??''})}}><option value="">None</option>{suppliers.map(row=><option key={row.id} value={row.id}>{row.displayName}</option>)}</select></label>{error&&<p className="error">{error}</p>}{error.includes('Confirm')&&<button type="button" className="warning-action" onClick={()=>{setDuplicateAcknowledged(true);setError('')}}>Confirm duplicate code</button>}<button className="primary-action" disabled={busy}>{busy?'Saving…':'Save Vessel'}</button><button type="button" disabled={busy} onClick={close}>Cancel</button></form></section></div>
}
function QuickCategory({order,create,saved,close}:{order:number;create:(input:PurchaseCategoryInput)=>Promise<PurchaseCategory>;saved:(item:PurchaseCategory)=>void;close:()=>void}){
  const [value,setValue]=useState<PurchaseCategoryInput>({categoryCode:'',displayName:'',order,notes:''});const [error,setError]=useState('');const [busy,setBusy]=useState(false);const lock=useRef(false)
  async function submit(e:FormEvent){e.preventDefault();if(lock.current)return;lock.current=true;setBusy(true);try{saved(await create(value))}catch(problem){setError(problem instanceof Error?problem.message:'Category was not saved.')}finally{lock.current=false;setBusy(false)}}
  return <div className="dialog-backdrop"><section className="form-dialog" role="dialog"><h2>Add Category</h2><form className="master-form" onSubmit={submit}><label>Category code<input value={value.categoryCode} onChange={e=>setValue({...value,categoryCode:e.target.value})}/></label><label>Display name<input value={value.displayName} onChange={e=>setValue({...value,displayName:e.target.value})}/></label>{error&&<p className="error">{error}</p>}<button className="primary-action" disabled={busy}>{busy?'Saving…':'Save Category'}</button><button type="button" disabled={busy} onClick={close}>Cancel</button></form></section></div>
}
