import { useRef,useState,type FormEvent } from 'react'
import {
  duplicatePartnerName,
  validateBusinessPartner,
  type BusinessPartner,
  type BusinessPartnerInput,
} from '../lib/masterData'

const empty=(role?:'supplier'|'customer'):BusinessPartnerInput=>({
  displayName:'',legalName:'',supplier:role==='supplier',customer:role==='customer',
  phone:'',registrationNo:'',paymentTermsDays:0,notes:'',
})

interface Props {
  partners:BusinessPartner[]
  partner?:BusinessPartner|null
  defaultRole?:'supplier'|'customer'
  save:(input:BusinessPartnerInput)=>Promise<BusinessPartner>
  onSaved:(partnerId:string,partner:BusinessPartner)=>void
  onClose:()=>void
}

export function BusinessPartnerFormDialog({partners,partner,defaultRole,save,onSaved,onClose}:Props){
  const [value,setValue]=useState<BusinessPartnerInput>(partner?{
    displayName:partner.displayName,legalName:partner.legalName,supplier:partner.supplier,customer:partner.customer,
    phone:partner.phone,registrationNo:partner.registrationNo,paymentTermsDays:partner.paymentTermsDays,notes:partner.notes,
  }:empty(defaultRole))
  const [error,setError]=useState('')
  const [duplicateConfirmed,setDuplicateConfirmed]=useState(false)
  const [saving,setSaving]=useState(false)
  const lock=useRef(false)
  const change=<K extends keyof BusinessPartnerInput>(key:K,next:BusinessPartnerInput[K])=>setValue(current=>({...current,[key]:next}))

  async function persist(){
    if(lock.current)return
    const errors=validateBusinessPartner(value)
    if(errors.length){setError(errors[0]);return}
    lock.current=true;setSaving(true);setError('')
    try{const result=await save(value);onSaved(result.id,result)}
    catch(problem){setError(problem instanceof Error?problem.message:'Business Partner was not saved.')}
    finally{lock.current=false;setSaving(false)}
  }
  async function submit(event:FormEvent){
    event.preventDefault()
    if(!duplicateConfirmed&&duplicatePartnerName(value.displayName,partners,partner?.id)){
      setError('A partner with the same display name already exists. Confirm if these are different companies.')
      return
    }
    await persist()
  }

  return <div className="dialog-backdrop" role="presentation">
    <section className="form-dialog" role="dialog" aria-modal="true" aria-labelledby="partner-form-title">
      <h2 id="partner-form-title">{partner?'Edit':'Add'} Business Partner</h2>
      <form className="master-form" onSubmit={submit}>
        <label>Display name<input value={value.displayName} maxLength={80} onChange={e=>{change('displayName',e.target.value);setDuplicateConfirmed(false)}}/></label>
        <label>Legal name<input value={value.legalName} maxLength={120} onChange={e=>change('legalName',e.target.value)}/></label>
        <fieldset><legend>Roles</legend>
          <label className="check-label"><input type="checkbox" checked={value.supplier} onChange={e=>change('supplier',e.target.checked)}/> Supplier</label>
          <label className="check-label"><input type="checkbox" checked={value.customer} onChange={e=>change('customer',e.target.checked)}/> Customer</label>
        </fieldset>
        <label>Phone<input value={value.phone} maxLength={30} onChange={e=>change('phone',e.target.value)}/></label>
        <label>Registration number<input value={value.registrationNo} maxLength={50} onChange={e=>change('registrationNo',e.target.value)}/></label>
        <label>Payment terms (days)<input type="number" min="0" max="365" value={value.paymentTermsDays} onChange={e=>change('paymentTermsDays',Number(e.target.value))}/></label>
        <label>Notes<textarea value={value.notes} maxLength={500} onChange={e=>change('notes',e.target.value)}/></label>
        {error&&<p className="error" role="alert">{error}</p>}
        {error.includes('same display name')&&<button type="button" className="warning-action" onClick={()=>{setDuplicateConfirmed(true);void persist()}}>Save duplicate anyway</button>}
        <button className="primary-action" disabled={saving}>{saving?'Saving…':'Save Business Partner'}</button>
        <button type="button" className="secondary-action" disabled={saving} onClick={onClose}>Cancel</button>
      </form>
    </section>
  </div>
}
