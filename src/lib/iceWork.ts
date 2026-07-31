export type IceWorkStatus='recorded'|'voided'

export interface IceWorkRecord {
  id:string
  workDate:string
  monthKey:string
  vesselId:string
  vesselCodeSnapshot:string
  factoryWoodTubQuantity:number
  iceBoxQuantity:number
  hawkerSaleQuantity:number
  oilWorkQuantity:number
  oilWorkRateCents:number|null
  oilWorkAmountCents:number|null
  headmanFeeCents:number
  clerkFeeCents:number
  monthEndSettlement:boolean
  notes:string
  status:IceWorkStatus
  createdBy:string
  createdAt?:unknown
  updatedBy?:string
  updatedAt?:unknown
  voided:boolean
  voidReason:string|null
  voidedBy:string|null
  voidedAt?:unknown|null
}

export function iceWorkMonthClosingId(vesselId:string,monthKey:string){
  return `${vesselId}_${monthKey}`
}

export function createIceWorkRecord(input:Pick<IceWorkRecord,'id'|'workDate'|'vesselId'|'vesselCodeSnapshot'|'createdBy'> & Partial<Pick<IceWorkRecord,'factoryWoodTubQuantity'|'iceBoxQuantity'|'hawkerSaleQuantity'|'oilWorkQuantity'|'oilWorkRateCents'|'oilWorkAmountCents'|'headmanFeeCents'|'clerkFeeCents'|'monthEndSettlement'|'notes'>>):IceWorkRecord {
  const monthEndSettlement=input.monthEndSettlement??false
  return {
    id:input.id,workDate:input.workDate,monthKey:input.workDate.slice(0,7),vesselId:input.vesselId,vesselCodeSnapshot:input.vesselCodeSnapshot,
    factoryWoodTubQuantity:input.factoryWoodTubQuantity??0,iceBoxQuantity:input.iceBoxQuantity??0,hawkerSaleQuantity:input.hawkerSaleQuantity??0,
    oilWorkQuantity:input.oilWorkQuantity??0,oilWorkRateCents:input.oilWorkRateCents??null,oilWorkAmountCents:input.oilWorkAmountCents??null,
    headmanFeeCents:monthEndSettlement?(input.headmanFeeCents??50_000):0,
    clerkFeeCents:monthEndSettlement?(input.clerkFeeCents??25_000):0,monthEndSettlement,
    notes:input.notes??'',status:'recorded',createdBy:input.createdBy,voided:false,voidReason:null,voidedBy:null,
  }
}

export function summarizeIceMonthEndFees(records:IceWorkRecord[]){
  const selected=records.find(record=>!record.voided&&record.status==='recorded'&&record.monthEndSettlement)
  return selected?{headmanFeeCents:selected.headmanFeeCents,clerkFeeCents:selected.clerkFeeCents,recordId:selected.id}:{headmanFeeCents:0,clerkFeeCents:0,recordId:null}
}

export function softVoidIceWorkRecord(record:IceWorkRecord,reason:string,userId:string):IceWorkRecord {
  const clean=reason.trim()
  if(clean.length<2)throw new Error('作废原因至少需要两个字。')
  if(record.voided)throw new Error('该冰工记录已作废。')
  return {...record,status:'voided',voided:true,voidReason:clean,voidedBy:userId}
}
