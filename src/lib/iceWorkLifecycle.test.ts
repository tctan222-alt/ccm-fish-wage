import { describe, expect, it } from 'vitest'
import { confirmIceWorkRecord, confirmIceWorkSettlement, createIceWorkAction, createIceWorkRecord, createIceWorkSettlement, createIceWorkSettlementAction, reopenIceWorkSettlement, reviseIceWorkRecord, reopenIceWorkRecord, softVoidIceWorkRecord, voidIceWorkSettlement } from './iceWork'

describe('冰工记录状态机', () => {
  const draft=()=>createIceWorkRecord({id:'r1',workDate:'31/07/2026',vesselId:'978',vesselCodeSnapshot:'978',createdBy:'u1'})
  it('only confirms a draft or reopened record, increasing revision',()=>{
    const confirmed=confirmIceWorkRecord(draft(),'u2')
    expect(confirmed).toMatchObject({status:'confirmed',revision:2,confirmedBy:'u2'})
    expect(()=>confirmIceWorkRecord(confirmed,'u2')).toThrow()
  })
  it('requires a reason to reopen or void and never reactivates a voided record',()=>{
    const confirmed=confirmIceWorkRecord(draft(),'u2')
    expect(()=>reopenIceWorkRecord(confirmed,'','u2')).toThrow()
    const reopened=reopenIceWorkRecord(confirmed,'更正重量','u2')
    expect(reopened).toMatchObject({status:'reopened',revision:3,reopenReason:'更正重量'})
    const voided=softVoidIceWorkRecord(reopened,'重复记录','u2')
    expect(voided).toMatchObject({status:'voided',voided:true,revision:4,voidReason:'重复记录'})
    expect(()=>reopenIceWorkRecord(voided,'不能恢复','u2')).toThrow()
  })
  it('only permits business edits while draft or reopened and recalculates amounts',()=>{
    const reopened=reopenIceWorkRecord(confirmIceWorkRecord(draft(),'u2'),'更正重量','u2')
    expect(reviseIceWorkRecord(reopened,{factoryIncomingWeightGrams:125_500},'u2')).toMatchObject({revision:4,factoryIncomingAmountCents:1_255,recordTotalCents:1_255})
    expect(()=>reviseIceWorkRecord(confirmIceWorkRecord(draft(),'u2'),{factoryIncomingWeightGrams:1_000},'u2')).toThrow()
  })
  it('locks confirmed settlements until a reasoned reopen or void',()=>{
    const record={...confirmIceWorkRecord(draft(),'u2'),factoryIncomingWeightGrams:1_000,factoryIncomingAmountCents:10,workFeeSubtotalCents:10,recordTotalCents:10}
    const settlement=createIceWorkSettlement({vesselId:'978',vesselCodeSnapshot:'978',monthKey:'07/2026',createdBy:'u1',records:[record]})
    const confirmed=confirmIceWorkSettlement(settlement,'u2')
    expect(confirmed).toMatchObject({status:'confirmed',revision:2,finalTotalCents:75_010})
    expect(()=>reopenIceWorkSettlement(confirmed,'','u2')).toThrow()
    expect(reopenIceWorkSettlement(confirmed,'补录确认记录','u2')).toMatchObject({status:'reopened',revision:3})
    expect(voidIceWorkSettlement(confirmed,'结算重复','u2')).toMatchObject({status:'voided',revision:3,voidReason:'结算重复'})
  })
  it('gives every immutable audit action a caller-stable operation id',()=>{
    const record=draft()
    expect(createIceWorkAction('create',record,'u1',null,'operation-001')).toMatchObject({recordId:'r1',type:'create',clientOperationId:'operation-001',revision:1})
    expect(()=>createIceWorkAction('create',record,'u1',null,'')).toThrow('操作编号')
  })
  it('uses the same immutable-operation mechanism for monthly settlements',()=>{
    const settlement=createIceWorkSettlement({vesselId:'978',vesselCodeSnapshot:'978',monthKey:'07/2026',createdBy:'u1',records:[]})
    expect(createIceWorkSettlementAction('create',settlement,'u1',null,'settlement-create-001')).toMatchObject({settlementId:'978_202607',clientOperationId:'settlement-create-001'})
  })
})
