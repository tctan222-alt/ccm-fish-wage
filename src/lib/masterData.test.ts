import { describe,expect,it } from 'vitest'
import {
  activeCustomers,
  activeSuppliers,
  assertPartnerCodeUnchanged,
  duplicatePartnerName,
  makePartnerCode,
  makeWorkerCode,
  normalizeBusinessPartner,
  normalizeWorker,
  validateBusinessPartner,
  validateWorker,
} from './masterData'

const basePartner={
  displayName:'Ocean Supply',
  legalName:'',
  supplier:true,
  customer:false,
  phone:'',
  registrationNo:'',
  paymentTermsDays:30,
  notes:'',
}

describe('business partner master data',()=>{
  it.each([
    [{supplier:true,customer:false},'Supplier'],
    [{supplier:false,customer:true},'Customer'],
    [{supplier:true,customer:true},'Both'],
  ])('accepts a %s role as %s',(roles)=>{
    expect(validateBusinessPartner({...basePartner,...roles})).toEqual([])
  })

  it('rejects a partner without a supplier or customer role',()=>{
    expect(validateBusinessPartner({...basePartner,supplier:false,customer:false})).toContain(
      'Select Supplier, Customer, or both.',
    )
  })

  it('validates trimmed display names and maximum length',()=>{
    expect(validateBusinessPartner({...basePartner,displayName:' '})).toContain(
      'Display name must be 2 to 80 characters.',
    )
    expect(validateBusinessPartner({...basePartner,displayName:'x'.repeat(81)})).toContain(
      'Display name must be 2 to 80 characters.',
    )
  })

  it.each([0,365])('accepts payment terms boundary %s days',(days)=>{
    expect(validateBusinessPartner({...basePartner,paymentTermsDays:days})).toEqual([])
  })

  it.each([-1,366,1.5])('rejects invalid payment terms %s',(days)=>{
    expect(validateBusinessPartner({...basePartner,paymentTermsDays:days})).toContain(
      'Payment terms must be a whole number from 0 to 365.',
    )
  })

  it('builds permanent codes from Firestore document IDs',()=>{
    expect(makePartnerCode('aBcD1234extra')).toBe('BP-ABCD1234')
    expect(makeWorkerCode('wXyZ9876extra')).toBe('WK-WXYZ9876')
  })

  it('rejects changing a permanent partner code',()=>{
    expect(()=>assertPartnerCodeUnchanged('BP-12345678','BP-87654321')).toThrow('cannot be changed')
    expect(()=>assertPartnerCodeUnchanged('BP-12345678','BP-12345678')).not.toThrow()
  })

  it('detects duplicate display names without treating case or spaces as different',()=>{
    expect(duplicatePartnerName(' ocean supply ',[
      {id:'p1',partnerCode:'BP-12345678',displayName:'Ocean Supply',legalName:'',supplier:true,customer:false,active:true,phone:'',registrationNo:'',paymentTermsDays:0,notes:'',inactiveBy:null},
    ])).toBe(true)
  })

  it('keeps inactive partners in management but excludes them from active role lists',()=>{
    const partners=[
      {id:'p1',partnerCode:'BP-11111111',displayName:'Active Both',legalName:'',supplier:true,customer:true,active:true,phone:'',registrationNo:'',paymentTermsDays:0,notes:'',inactiveBy:null},
      {id:'p2',partnerCode:'BP-22222222',displayName:'Old Both',legalName:'',supplier:true,customer:true,active:false,phone:'',registrationNo:'',paymentTermsDays:0,notes:'',inactiveBy:'admin'},
    ]
    expect(activeSuppliers(partners).map(item=>item.id)).toEqual(['p1'])
    expect(activeCustomers(partners).map(item=>item.id)).toEqual(['p1'])
    expect(partners).toHaveLength(2)
  })

  it('trims partner text fields before saving',()=>{
    expect(normalizeBusinessPartner({...basePartner,displayName:' Ocean ',phone:' 0123 '}))
      .toMatchObject({displayName:'Ocean',phone:'0123'})
  })
})

describe('worker master data',()=>{
  it('loads a legacy worker without new optional fields',()=>{
    expect(normalizeWorker({id:'legacy',name:' Ali ',active:true,order:2}))
      .toMatchObject({id:'legacy',name:'Ali',workerCode:'',department:'',workerDepartment:undefined})
  })

  it('rejects an employment end date before the start date',()=>{
    expect(validateWorker({
      name:'Ali',phone:'',department:'fish_head',
      employmentStartDate:'2026-07-10',employmentEndDate:'2026-07-09',notes:'',
    })).toContain('End date cannot be earlier than start date.')
  })
})
