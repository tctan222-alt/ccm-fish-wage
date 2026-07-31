import { useEffect,useState,type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import type { BusinessPartner } from '../lib/masterData'
import { duplicateVesselCode,type Vessel,type VesselInput } from '../lib/purchasing'
import { loadActiveSuppliers } from '../services/businessPartners'
import { createVessel,deactivateVessel,loadVessels,reactivateVessel,updateVessel } from '../services/purchaseMasterData'

interface Props {loader?:()=>Promise<Vessel[]>;supplierLoader?:()=>Promise<BusinessPartner[]>;creator?:(value:VesselInput)=>Promise<Vessel>;
  updater?:(item:Vessel,value:VesselInput)=>Promise<Vessel>;deactivator?:(item:Vessel)=>Promise<void>;reactivator?:(item:Vessel)=>Promise<void>;onCreated?:(item:Vessel)=>void}
export function VesselsPage({loader=loadVessels,supplierLoader=loadActiveSuppliers,creator=createVessel,updater=updateVessel,
  deactivator=deactivateVessel,reactivator=reactivateVessel,onCreated=()=>{}}:Props){
  const [items,setItems]=useState<Vessel[]|null>(null);const [suppliers,setSuppliers]=useState<BusinessPartner[]>([])
  const [editing,setEditing]=useState<Vessel|null|undefined>(undefined);const [error,setError]=useState('');const [busy,setBusy]=useState(false)
  useEffect(()=>{void Promise.all([loader(),supplierLoader()]).then(([rows,partners])=>{setItems(rows);setSuppliers(partners)}).catch(()=>{setItems([]);setError('Vessels could not be loaded.')})},[loader,supplierLoader])
  async function toggle(item:Vessel){setBusy(true);try{if(item.active)await deactivator(item);else await reactivator(item)
    setItems(current=>current?.map(row=>row.id===item.id?{...row,active:!item.active}:row)??[])}catch{setError('Vessel status was not changed.')}finally{setBusy(false)}}
  return <main><header><p className="eyebrow">CCM Fishery</p><h1>Vessels</h1><Link className="page-link" to="/master-data">← Master Data</Link></header>
    <button className="primary-action master-add" onClick={()=>setEditing(null)}>Add Vessel</button>{error&&<p className="error" role="alert">{error}</p>}
    {items===null?<p className="notice">Loading vessels…</p>:<div className="master-card-list">{items.map(item=><article className="master-card" key={item.id}>
      <div className="master-card-heading"><div><small>{item.vesselCode}</small><h2>{item.displayName}</h2></div><span className={`record-status ${item.active?'active':'inactive'}`}>{item.active?'Active':'Inactive'}</span></div>
      <p>Default supplier: {item.defaultSupplierNameSnapshot||'—'}</p>{item.notes&&<p>{item.notes}</p>}
      <div className="master-actions"><button onClick={()=>setEditing(item)}>Edit</button><button disabled={busy} className={item.active?'danger-action':'activate-action'} onClick={()=>void toggle(item)}>{item.active?'Deactivate':'Reactivate'}</button></div>
    </article>)}</div>}
    {editing!==undefined&&<VesselDialog item={editing} existing={items??[]} suppliers={suppliers} save={value=>editing?updater(editing,value):creator(value)}
      close={()=>setEditing(undefined)} saved={item=>{setItems(current=>editing?current?.map(row=>row.id===item.id?item:row)??[]:[...(current??[]),item]);if(!editing)onCreated(item);setEditing(undefined)}}/>}
  </main>
}
function VesselDialog({item,existing,suppliers,save,saved,close}:{item:Vessel|null;existing:Vessel[];suppliers:BusinessPartner[];save:(value:VesselInput)=>Promise<Vessel>;saved:(item:Vessel)=>void;close:()=>void}){
  const [value,setValue]=useState<VesselInput>(item?{vesselCode:item.vesselCode,displayName:item.displayName,defaultSupplierId:item.defaultSupplierId,defaultSupplierNameSnapshot:item.defaultSupplierNameSnapshot,order:item.order??0,notes:item.notes}:{vesselCode:'',displayName:'',defaultSupplierId:'',defaultSupplierNameSnapshot:'',order:0,notes:''})
  const [ack,setAck]=useState(false);const [error,setError]=useState('');const [busy,setBusy]=useState(false)
  async function submit(event:FormEvent){event.preventDefault();if(!ack&&duplicateVesselCode(value.vesselCode,existing,item?.id)){setError('A vessel with this code exists. Confirm these are different vessels.');return}
    setBusy(true);try{saved(await save(value))}catch(problem){setError(problem instanceof Error?problem.message:'Vessel was not saved.')}finally{setBusy(false)}}
  return <div className="dialog-backdrop"><section className="form-dialog" role="dialog" aria-modal="true"><h2>{item?'Edit':'Add'} Vessel</h2>
    <form className="master-form" onSubmit={submit}><label>Vessel code<input value={value.vesselCode} maxLength={30} onChange={e=>{setValue({...value,vesselCode:e.target.value});setAck(false)}}/></label>
      <label>Display name<input value={value.displayName} maxLength={80} onChange={e=>setValue({...value,displayName:e.target.value})}/></label>
      <label>Display order<input type="number" min="0" step="1" value={value.order??0} onChange={e=>setValue({...value,order:Number(e.target.value)})}/></label>
      <label>Default supplier<select value={value.defaultSupplierId} onChange={e=>{const supplier=suppliers.find(row=>row.id===e.target.value);setValue({...value,defaultSupplierId:e.target.value,defaultSupplierNameSnapshot:supplier?.displayName??''})}}><option value="">None</option>{suppliers.map(row=><option key={row.id} value={row.id}>{row.displayName}</option>)}</select></label>
      <label>Notes<textarea value={value.notes} maxLength={500} onChange={e=>setValue({...value,notes:e.target.value})}/></label>
      {error&&<p className="error" role="alert">{error}</p>}{error.includes('Confirm')&&<button type="button" className="warning-action" onClick={()=>{setAck(true);setError('')}}>Confirm duplicate code</button>}
      <button className="primary-action" disabled={busy}>Save Vessel</button><button type="button" onClick={close}>Cancel</button>
    </form></section></div>
}
