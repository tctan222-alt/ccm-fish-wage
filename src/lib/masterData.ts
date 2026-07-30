import type { Worker } from '../types'

export interface BusinessPartner {
  id:string
  partnerCode:string
  displayName:string
  legalName:string
  supplier:boolean
  customer:boolean
  active:boolean
  phone:string
  registrationNo:string
  paymentTermsDays:number
  notes:string
  createdBy?:string
  createdAt?:unknown
  updatedBy?:string
  updatedAt?:unknown
  inactiveBy:string|null
  inactiveAt?:unknown|null
}

export interface BusinessPartnerInput {
  displayName:string
  legalName:string
  supplier:boolean
  customer:boolean
  phone:string
  registrationNo:string
  paymentTermsDays:number
  notes:string
}

export interface WorkerInput {
  name:string
  phone:string
  department:string
  employmentStartDate:string
  employmentEndDate:string
  notes:string
}

function clean(value:string){return value.trim()}
function generatedCode(prefix:string,id:string){return `${prefix}-${id.replace(/[^a-z0-9]/gi,'').slice(0,8).toUpperCase().padEnd(8,'0')}`}

export const makePartnerCode=(id:string)=>generatedCode('BP',id)
export const makeWorkerCode=(id:string)=>generatedCode('WK',id)

export function normalizeBusinessPartner(input:BusinessPartnerInput):BusinessPartnerInput {
  return {
    ...input,
    displayName:clean(input.displayName),
    legalName:clean(input.legalName),
    phone:clean(input.phone),
    registrationNo:clean(input.registrationNo),
    notes:clean(input.notes),
  }
}

export function validateBusinessPartner(input:BusinessPartnerInput):string[] {
  const value=normalizeBusinessPartner(input)
  const errors:string[]=[]
  if(value.displayName.length<2||value.displayName.length>80)errors.push('Display name must be 2 to 80 characters.')
  if(value.legalName.length>120)errors.push('Legal name must be 120 characters or fewer.')
  if(!value.supplier&&!value.customer)errors.push('Select Supplier, Customer, or both.')
  if(value.phone.length>30)errors.push('Phone must be 30 characters or fewer.')
  if(value.registrationNo.length>50)errors.push('Registration number must be 50 characters or fewer.')
  if(!Number.isInteger(value.paymentTermsDays)||value.paymentTermsDays<0||value.paymentTermsDays>365){
    errors.push('Payment terms must be a whole number from 0 to 365.')
  }
  if(value.notes.length>500)errors.push('Notes must be 500 characters or fewer.')
  return errors
}

export function duplicatePartnerName(name:string,partners:BusinessPartner[],excludeId=''){
  const key=clean(name).toLocaleLowerCase()
  return partners.some(partner=>partner.id!==excludeId&&clean(partner.displayName).toLocaleLowerCase()===key)
}

export const activeSuppliers=(partners:BusinessPartner[])=>partners.filter(item=>item.active&&item.supplier)
export const activeCustomers=(partners:BusinessPartner[])=>partners.filter(item=>item.active&&item.customer)
export function assertPartnerCodeUnchanged(existing:string,next:string){
  if(existing!==next)throw new Error('Partner code cannot be changed.')
}

export function normalizeWorker(raw:Worker):Worker {
  return {
    ...raw,
    name:clean(raw.name),
    workerCode:raw.workerCode??'',
    phone:raw.phone??'',
    department:raw.department??'fish_head',
    employmentStartDate:raw.employmentStartDate??'',
    employmentEndDate:raw.employmentEndDate??'',
    notes:raw.notes??'',
    inactiveBy:raw.inactiveBy??null,
    inactiveAt:raw.inactiveAt??null,
  }
}

export function normalizeWorkerInput(input:WorkerInput):WorkerInput {
  return {
    name:clean(input.name),
    phone:clean(input.phone),
    department:clean(input.department)||'fish_head',
    employmentStartDate:input.employmentStartDate,
    employmentEndDate:input.employmentEndDate,
    notes:clean(input.notes),
  }
}

export function validateWorker(input:WorkerInput):string[] {
  const value=normalizeWorkerInput(input)
  const errors:string[]=[]
  if(value.name.length<1||value.name.length>100)errors.push('Worker name must be 1 to 100 characters.')
  if(value.phone.length>30)errors.push('Phone must be 30 characters or fewer.')
  if(value.department.length<1||value.department.length>50)errors.push('Department must be 1 to 50 characters.')
  if(value.notes.length>500)errors.push('Notes must be 500 characters or fewer.')
  if(value.employmentStartDate&&value.employmentEndDate&&value.employmentEndDate<value.employmentStartDate){
    errors.push('End date cannot be earlier than start date.')
  }
  return errors
}
