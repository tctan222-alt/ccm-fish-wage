import { useEffect,useState,type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import {
  duplicateVesselCode,type PurchaseCategory,type PurchaseCategoryInput,
} from '../lib/purchasing'
import {
  createPurchaseCategory,deactivatePurchaseCategory,initializeDefaultPurchaseCategories,loadPurchaseCategories,
  reactivatePurchaseCategory,updatePurchaseCategory,
} from '../services/purchaseMasterData'

interface Props {
  loader?:()=>Promise<PurchaseCategory[]>;initializer?:()=>Promise<PurchaseCategory[]>
  creator?:(input:PurchaseCategoryInput)=>Promise<PurchaseCategory>
  updater?:(item:PurchaseCategory,input:PurchaseCategoryInput)=>Promise<PurchaseCategory>
  deactivator?:(item:PurchaseCategory)=>Promise<void>;reactivator?:(item:PurchaseCategory)=>Promise<void>
  onCreated?:(item:PurchaseCategory)=>void
}
export function PurchaseCategoriesPage({loader=loadPurchaseCategories,initializer=initializeDefaultPurchaseCategories,
  creator=createPurchaseCategory,updater=updatePurchaseCategory,deactivator=deactivatePurchaseCategory,
  reactivator=reactivatePurchaseCategory,onCreated=()=>{}}:Props){
  const [items,setItems]=useState<PurchaseCategory[]|null>(null);const [editing,setEditing]=useState<PurchaseCategory|null|undefined>(undefined)
  const [error,setError]=useState('');const [busy,setBusy]=useState(false)
  useEffect(()=>{loader().then(setItems).catch(()=>{setItems([]);setError('Categories could not be loaded.')})},[loader])
  async function toggle(item:PurchaseCategory){setBusy(true);try{if(item.active)await deactivator(item);else await reactivator(item)
    setItems(current=>current?.map(row=>row.id===item.id?{...row,active:!item.active}:row)??[])}catch{setError('Category status was not changed.')}finally{setBusy(false)}}
  async function initialize(){if(!window.confirm('Initialize the nine CCM default purchase categories?'))return
    setBusy(true);try{setItems(await initializer())}catch{setError('Default categories were not initialized.')}finally{setBusy(false)}}
  return <main><header><p className="eyebrow">CCM Fishery</p><h1>Purchase Categories</h1><Link className="page-link" to="/master-data">← Master Data</Link></header>
    {items?.length===0&&<button className="primary-action master-add" disabled={busy} onClick={()=>void initialize()}>Initialize CCM default categories</button>}
    <button className="primary-action master-add" onClick={()=>setEditing(null)}>Add Category</button>
    {error&&<p className="error" role="alert">{error}</p>}
    {items===null?<p className="notice">Loading categories…</p>:<div className="master-card-list">{items.map(item=><article className="master-card" key={item.id}>
      <div className="master-card-heading"><div><small>{item.categoryCode}</small><h2>{item.displayName}</h2></div>
        <span className={`record-status ${item.active?'active':'inactive'}`}>{item.active?'Active':'Inactive'}</span></div>
      <p>Order: {item.order}</p>{item.notes&&<p>{item.notes}</p>}
      <div className="master-actions"><button onClick={()=>setEditing(item)}>Edit</button><button disabled={busy} className={item.active?'danger-action':'activate-action'} onClick={()=>void toggle(item)}>{item.active?'Deactivate':'Reactivate'}</button></div>
    </article>)}</div>}
    {editing!==undefined&&<CategoryDialog item={editing} existing={items??[]} save={input=>editing?updater(editing,input):creator(input)}
      close={()=>setEditing(undefined)} saved={item=>{setItems(current=>editing?current?.map(row=>row.id===item.id?item:row)??[]:[...(current??[]),item]);if(!editing)onCreated(item);setEditing(undefined)}}/>}
  </main>
}
function CategoryDialog({item,existing,save,saved,close}:{item:PurchaseCategory|null;existing:PurchaseCategory[];save:(value:PurchaseCategoryInput)=>Promise<PurchaseCategory>;saved:(item:PurchaseCategory)=>void;close:()=>void}){
  const [value,setValue]=useState<PurchaseCategoryInput>(item?{categoryCode:item.categoryCode,displayName:item.displayName,order:item.order,notes:item.notes}:{categoryCode:'',displayName:'',order:existing.length,notes:''})
  const [error,setError]=useState('');const [busy,setBusy]=useState(false)
  async function submit(event:FormEvent){event.preventDefault()
    if(!item&&duplicateVesselCode(value.categoryCode,existing.map(row=>({id:row.id,vesselCode:row.categoryCode,displayName:'',defaultSupplierId:'',defaultSupplierNameSnapshot:'',active:true,notes:''})))){setError('This category code already exists.');return}
    setBusy(true);try{saved(await save(value))}catch(problem){setError(problem instanceof Error?problem.message:'Category was not saved.')}finally{setBusy(false)}}
  return <div className="dialog-backdrop"><section className="form-dialog" role="dialog" aria-modal="true"><h2>{item?'Edit':'Add'} Category</h2>
    <form className="master-form" onSubmit={submit}><label>Category code<input disabled={Boolean(item)} value={value.categoryCode} onChange={e=>setValue({...value,categoryCode:e.target.value})}/></label>
      <label>Display name<input value={value.displayName} onChange={e=>setValue({...value,displayName:e.target.value})}/></label>
      <label>Order<input type="number" min="0" value={value.order} onChange={e=>setValue({...value,order:Number(e.target.value)})}/></label>
      <label>Notes<textarea value={value.notes} onChange={e=>setValue({...value,notes:e.target.value})}/></label>
      {error&&<p className="error" role="alert">{error}</p>}<button className="primary-action" disabled={busy}>Save Category</button><button type="button" onClick={close}>Cancel</button>
    </form></section></div>
}
