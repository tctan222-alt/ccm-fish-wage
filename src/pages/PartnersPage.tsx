import { useEffect,useMemo,useState } from 'react'
import { Link } from 'react-router-dom'
import { BusinessPartnerFormDialog } from '../components/BusinessPartnerFormDialog'
import type { BusinessPartner,BusinessPartnerInput } from '../lib/masterData'
import {
  createBusinessPartner,deactivateBusinessPartner,loadBusinessPartners,
  reactivateBusinessPartner,updateBusinessPartner,
} from '../services/businessPartners'

type Filter='all'|'suppliers'|'customers'|'both'|'inactive'
interface Props {
  loader?:()=>Promise<BusinessPartner[]>
  creator?:(input:BusinessPartnerInput)=>Promise<BusinessPartner>
  updater?:(partner:BusinessPartner,input:BusinessPartnerInput)=>Promise<BusinessPartner>
  deactivator?:(partner:BusinessPartner)=>Promise<void>
  reactivator?:(partner:BusinessPartner)=>Promise<void>
  onPartnerCreated?:(partnerId:string)=>void
}

export function PartnersPage({
  loader=loadBusinessPartners,creator=createBusinessPartner,updater=updateBusinessPartner,
  deactivator=deactivateBusinessPartner,reactivator=reactivateBusinessPartner,onPartnerCreated=()=>{},
}:Props){
  const [partners,setPartners]=useState<BusinessPartner[]|null>(null)
  const [search,setSearch]=useState('')
  const [filter,setFilter]=useState<Filter>('all')
  const [editing,setEditing]=useState<BusinessPartner|null|undefined>(undefined)
  const [error,setError]=useState('')
  const [busyId,setBusyId]=useState('')
  useEffect(()=>{loader().then(setPartners).catch(()=>{setPartners([]);setError('Business Partners could not be loaded.')})},[loader])
  const visible=useMemo(()=>(partners??[]).filter(partner=>{
    const haystack=[partner.displayName,partner.legalName,partner.phone,partner.registrationNo].join(' ').toLocaleLowerCase()
    const matches=haystack.includes(search.trim().toLocaleLowerCase())
    const role=filter==='all'||(filter==='suppliers'&&partner.active&&partner.supplier)
      ||(filter==='customers'&&partner.active&&partner.customer)||(filter==='both'&&partner.active&&partner.supplier&&partner.customer)
      ||(filter==='inactive'&&!partner.active)
    return matches&&role
  }),[partners,search,filter])
  const summary=useMemo(()=>({
    suppliers:(partners??[]).filter(p=>p.active&&p.supplier).length,
    customers:(partners??[]).filter(p=>p.active&&p.customer).length,
    both:(partners??[]).filter(p=>p.active&&p.supplier&&p.customer).length,
    inactive:(partners??[]).filter(p=>!p.active).length,
  }),[partners])

  async function toggle(partner:BusinessPartner){
    if(busyId)return
    if(partner.active&&!window.confirm(`Deactivate ${partner.displayName}? Historical records will remain unchanged.`))return
    setBusyId(partner.id)
    try{
      if(partner.active)await deactivator(partner);else await reactivator(partner)
      setPartners(current=>current?.map(item=>item.id===partner.id?{...item,active:!partner.active,inactiveBy:partner.active?'current-user':null}:item)??[])
    }catch{setError('Partner status was not changed.')}finally{setBusyId('')}
  }
  return <main>
    <header><p className="eyebrow">CCM Fishery</p><h1>Business Partners</h1><Link className="page-link" to="/master-data">← Master Data</Link></header>
    <section className="master-summary">
      <div><span>Active Suppliers</span><strong>{summary.suppliers}</strong></div>
      <div><span>Active Customers</span><strong>{summary.customers}</strong></div>
      <div><span>Both</span><strong>{summary.both}</strong></div>
      <div><span>Inactive</span><strong>{summary.inactive}</strong></div>
    </section>
    <button className="primary-action master-add" onClick={()=>setEditing(null)}>Add Business Partner</button>
    <section className="master-filters">
      <label>Search partners<input value={search} onChange={e=>setSearch(e.target.value)}/></label>
      <label>Partner filter<select value={filter} onChange={e=>setFilter(e.target.value as Filter)}>
        <option value="all">All</option><option value="suppliers">Suppliers</option><option value="customers">Customers</option>
        <option value="both">Both</option><option value="inactive">Inactive</option>
      </select></label>
    </section>
    {error&&<p className="error" role="alert">{error}</p>}
    {partners===null?<p className="notice">Loading Business Partners…</p>:<div className="master-card-list">
      {visible.map(partner=><article className="master-card" key={partner.id}>
        <div className="master-card-heading"><div><small>{partner.partnerCode}</small><h2>{partner.displayName}</h2></div><span className={`record-status ${partner.active?'active':'inactive'}`}>{partner.active?'Active':'Inactive'}</span></div>
        {partner.legalName&&<p>{partner.legalName}</p>}
        <div className="role-badges">{partner.supplier&&<span>Supplier</span>}{partner.customer&&<span>Customer</span>}</div>
        <dl><div><dt>Phone</dt><dd>{partner.phone||'—'}</dd></div><div><dt>Payment terms</dt><dd>{partner.paymentTermsDays} days</dd></div></dl>
        <div className="master-actions"><button disabled={busyId===partner.id} onClick={()=>setEditing(partner)}>Edit</button><button disabled={busyId===partner.id} className={partner.active?'danger-action':'activate-action'} onClick={()=>void toggle(partner)}>{busyId===partner.id?'Saving…':partner.active?'Deactivate':'Reactivate'}</button></div>
      </article>)}
    </div>}
    {editing!==undefined&&<BusinessPartnerFormDialog partners={partners??[]} partner={editing} save={input=>editing?updater(editing,input):creator(input)}
      onClose={()=>setEditing(undefined)} onSaved={(id,result)=>{setPartners(current=>editing?current?.map(item=>item.id===id?result:item)??[]:[...(current??[]),result]);if(!editing)onPartnerCreated(id);setEditing(undefined)}}/>}
  </main>
}
