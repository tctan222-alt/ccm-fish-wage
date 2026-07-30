export type VesselTripStatus='draft'|'confirmed'|'settled'|'voided'
export type VesselCrewRole='captain'|'crew'
export type VesselPaymentMethod='cash'|'bank'|'other'

export interface VesselWageTemplate {
  id:string
  vesselId:string
  vesselCode:string
  name:string
  dayRateCents:number
  nightRateCents:number
  captainDayRateCents?:number
  captainNightRateCents?:number
  crewDayRateCents?:number
  crewNightRateCents?:number
  crewHeadcount?:number
  active:boolean
}

export interface VesselCrewWageRate {
  role:VesselCrewRole
  headcount:number
  dayRateCents:number
  nightRateCents:number
}

export const DEFAULT_VESSEL_CREW_WAGE_RATES:VesselCrewWageRate[]=[
  {role:'captain',headcount:1,dayRateCents:14000,nightRateCents:10000},
  {role:'crew',headcount:4,dayRateCents:9000,nightRateCents:5000},
]

export function crewWageRateForRole(role:VesselCrewRole){
  return DEFAULT_VESSEL_CREW_WAGE_RATES.find(item=>item.role===role)!
}

export function crewWageRateForTemplate(template:VesselWageTemplate|undefined,role:VesselCrewRole){
  const fallback=crewWageRateForRole(role)
  if(!template)return fallback
  return role==='captain'
    ?{...fallback,dayRateCents:template.captainDayRateCents??fallback.dayRateCents,
      nightRateCents:template.captainNightRateCents??fallback.nightRateCents}
    :{...fallback,headcount:template.crewHeadcount??fallback.headcount,
      dayRateCents:template.crewDayRateCents??fallback.dayRateCents,
      nightRateCents:template.crewNightRateCents??fallback.nightRateCents}
}

export const DEFAULT_VESSEL_WAGE_TEMPLATES:VesselWageTemplate[]=[
  {id:'default-978',vesselId:'',vesselCode:'978',name:'978 Standard',dayRateCents:50000,nightRateCents:30000,active:true},
  {id:'default-833',vesselId:'',vesselCode:'833',name:'833 Standard',dayRateCents:50000,nightRateCents:30000,active:true},
]

export interface VesselTrip {
  id:string
  tripCode:string
  vesselId:string
  vesselCodeSnapshot:string
  vesselNameSnapshot:string
  departureDate:string
  returnDate:string
  status:VesselTripStatus
  incomeCents:number
  expenseCents:number
  crewWageCents:number
  crewAdvanceCents:number
  crewPaidCents:number
  profitCents:number
  notes:string
  revision:number
  voidReason:string|null
}

export type VesselTripInput=VesselTrip

export interface CrewWageCalculation {
  halfDayUnits:number
  nightCount:number
  dayRateCents:number
  nightRateCents:number
}

export interface VesselCrewSettlement extends CrewWageCalculation {
  id:string
  workerId:string
  workerNameSnapshot:string
  role:VesselCrewRole
  templateId:string
  grossWageCents:number
  advanceCents:number
  paidCents:number
  balanceCents:number
}

export interface CreateCrewSettlementInput extends Omit<VesselCrewSettlement,'grossWageCents'|'balanceCents'|'advanceCents'|'paidCents'> {
  advanceCents?:number
  paidCents?:number
}

export interface VesselCrewPayment {
  id:string
  tripId:string
  crewSettlementId:string
  workerId:string
  workerNameSnapshot:string
  paymentType:'advance'|'settlement'
  amountCents:number
  method:VesselPaymentMethod
  paymentDate:string
  reference:string
  note:string
  voided:boolean
  voidReason:string|null
}

function integerCents(value:number){return Number.isInteger(value)&&value>=0}
function dateKey(value:string){return /^\d{4}-\d{2}-\d{2}$/.test(value)}

export function calculateCrewWage(value:CrewWageCalculation){
  if(!Number.isInteger(value.halfDayUnits)||value.halfDayUnits<0)throw new Error('Days must use whole half-day units.')
  if(!Number.isInteger(value.nightCount)||value.nightCount<0)throw new Error('Night count must be a non-negative whole number.')
  if(!integerCents(value.dayRateCents)||!integerCents(value.nightRateCents))throw new Error('Wage rates must use non-negative integer cents.')
  const result=value.halfDayUnits*value.dayRateCents/2+value.nightCount*value.nightRateCents
  if(!Number.isInteger(result))throw new Error('Wage calculation must resolve to integer cents.')
  return result
}

export function formatHalfDayUnits(units:number){
  if(!Number.isInteger(units)||units<0)throw new Error('Days must use whole half-day units.')
  return units%2===0?String(units/2):`${Math.floor(units/2)}.5`
}

export function createCrewSettlement(input:CreateCrewSettlementInput):VesselCrewSettlement {
  const grossWageCents=calculateCrewWage(input)
  const advanceCents=input.advanceCents??0
  const paidCents=input.paidCents??0
  return {...input,workerNameSnapshot:input.workerNameSnapshot.trim(),grossWageCents,advanceCents,paidCents,
    balanceCents:grossWageCents-advanceCents-paidCents}
}

export function validateCrewSettlement(value:VesselCrewSettlement){
  const errors:string[]=[]
  if(!value.workerId||!value.workerNameSnapshot.trim())errors.push('Select a crew member.')
  if(!['captain','crew'].includes(value.role))errors.push('Select Captain or Crew.')
  if(!Number.isInteger(value.halfDayUnits)||value.halfDayUnits<1)errors.push('Days must use whole half-day units.')
  if(!Number.isInteger(value.nightCount)||value.nightCount<0)errors.push('Night count must be a non-negative whole number.')
  if(!integerCents(value.dayRateCents)||!integerCents(value.nightRateCents))errors.push('Wage rates must use non-negative integer cents.')
  if(!integerCents(value.advanceCents))errors.push('Advance must be a non-negative integer number of cents.')
  if(value.advanceCents>value.grossWageCents)errors.push('Advance cannot exceed gross wage.')
  if(!integerCents(value.paidCents)||value.advanceCents+value.paidCents>value.grossWageCents)errors.push('Crew payments cannot exceed gross wage.')
  return errors
}

export function addCrewPayment(settlement:VesselCrewSettlement,amountCents:number,paymentType:'advance'|'settlement'='settlement'):VesselCrewSettlement {
  if(!Number.isInteger(amountCents)||amountCents<=0)throw new Error('Payment must be a positive integer number of cents.')
  if(amountCents>settlement.balanceCents)throw new Error('Payment exceeds outstanding crew wage.')
  return {...settlement,advanceCents:settlement.advanceCents+(paymentType==='advance'?amountCents:0),
    paidCents:settlement.paidCents+(paymentType==='settlement'?amountCents:0),balanceCents:settlement.balanceCents-amountCents}
}

export function voidCrewPayment(settlement:VesselCrewSettlement,payment:VesselCrewPayment,reason:string){
  if(payment.voided)throw new Error('This crew payment is already voided.')
  const cleanReason=reason.trim()
  if(cleanReason.length<3||cleanReason.length>100)throw new Error('Void reason must be 3 to 100 characters.')
  const advanceCents=settlement.advanceCents-(payment.paymentType==='advance'?payment.amountCents:0)
  const paidCents=settlement.paidCents-(payment.paymentType==='settlement'?payment.amountCents:0)
  if(advanceCents<0||paidCents<0)throw new Error('Crew payment totals are inconsistent.')
  return {
    settlement:{...settlement,advanceCents,paidCents,balanceCents:settlement.balanceCents+payment.amountCents},
    payment:{...payment,voided:true,voidReason:cleanReason},
  }
}

export function calculateTripSettlement(value:Pick<VesselTrip,'incomeCents'|'expenseCents'|'crewWageCents'|'crewAdvanceCents'|'crewPaidCents'>){
  return {
    profitCents:value.incomeCents-value.expenseCents-value.crewWageCents,
    crewOutstandingCents:value.crewWageCents-value.crewAdvanceCents-value.crewPaidCents,
  }
}

export function normalizeTripInput(value:VesselTripInput):VesselTripInput {
  return {...value,tripCode:value.tripCode.trim(),vesselCodeSnapshot:value.vesselCodeSnapshot.trim(),
    vesselNameSnapshot:value.vesselNameSnapshot.trim(),notes:value.notes.trim()}
}

export function validateTripInput(raw:VesselTripInput){
  const value=normalizeTripInput(raw)
  const errors:string[]=[]
  if(value.tripCode.length<1||value.tripCode.length>50)errors.push('Trip code must be 1 to 50 characters.')
  if(!value.vesselId)errors.push('Select a Vessel.')
  if(!dateKey(value.departureDate)||!dateKey(value.returnDate))errors.push('Valid departure and return dates are required.')
  if(value.departureDate&&value.returnDate&&value.returnDate<value.departureDate)errors.push('Return date cannot be earlier than departure date.')
  if(!integerCents(value.incomeCents))errors.push('Income must be a non-negative integer number of cents.')
  if(!integerCents(value.expenseCents))errors.push('Expenses must be a non-negative integer number of cents.')
  if(value.notes.length>500)errors.push('Notes must be 500 characters or fewer.')
  return errors
}

export function voidVesselTrip(value:VesselTrip,reason:string):VesselTrip {
  const cleanReason=reason.trim()
  if(cleanReason.length<3||cleanReason.length>100)throw new Error('Void reason must be 3 to 100 characters.')
  if(value.crewAdvanceCents>0||value.crewPaidCents>0)throw new Error('Void active crew advances and payments before voiding this trip.')
  if(value.status==='voided')throw new Error('This vessel trip is already voided.')
  return {...value,status:'voided',voidReason:cleanReason,revision:value.revision+1}
}

export function settleVesselTrip(value:VesselTrip):VesselTrip {
  if(value.status!=='confirmed')throw new Error('Only a confirmed Vessel Trip can be settled.')
  if(value.crewWageCents-value.crewAdvanceCents-value.crewPaidCents!==0){
    throw new Error('All crew wages must be paid or advanced before settlement.')
  }
  return {...value,status:'settled',revision:value.revision+1}
}

export function assertCrewPaymentCanBeVoided(trip:VesselTrip){
  if(!['draft','confirmed'].includes(trip.status))throw new Error('Crew payments can only be voided before trip settlement.')
}
