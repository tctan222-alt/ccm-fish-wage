import { describe, expect, it } from 'vitest'
import {
  DEFAULT_VESSEL_WAGE_TEMPLATES,
  DEFAULT_VESSEL_CREW_WAGE_RATES,
  addCrewPayment,
  assertCrewPaymentCanBeVoided,
  calculateCrewWage,
  calculateTripSettlement,
  createCrewSettlement,
  formatHalfDayUnits,
  normalizeTripInput,
  settleVesselTrip,
  validateCrewSettlement,
  validateTripInput,
  voidCrewPayment,
  voidVesselTrip,
  type VesselCrewPayment,
  type VesselTrip,
} from './vesselTrips'

const trip = (overrides:Partial<VesselTrip>={}):VesselTrip=>({
  id:'trip-1',tripCode:'TRIP-978-20260701',vesselId:'v978',vesselCodeSnapshot:'978',
  vesselNameSnapshot:'Boat 978',departureDate:'2026-07-01',returnDate:'2026-07-13',
  status:'draft',incomeCents:0,expenseCents:0,crewWageCents:0,crewAdvanceCents:0,
  crewPaidCents:0,profitCents:0,notes:'',revision:1,voidReason:null,...overrides,
})

describe('vessel wage templates',()=>{
  it('provides reviewed defaults for vessels 978 and 833',()=>{
    expect(DEFAULT_VESSEL_WAGE_TEMPLATES.map(item=>[item.vesselCode,item.dayRateCents,item.nightRateCents]))
      .toEqual([['978',50000,30000],['833',50000,30000]])
  })

  it('calculates 11.5 days and 2 nights as RM6,350',()=>{
    expect(calculateCrewWage({halfDayUnits:23,nightCount:2,dayRateCents:50000,nightRateCents:30000}))
      .toBe(635000)
  })

  it('keeps captain and four crew wage rates separate from the vessel total',()=>{
    expect(DEFAULT_VESSEL_CREW_WAGE_RATES).toEqual([
      {role:'captain',headcount:1,dayRateCents:14000,nightRateCents:10000},
      {role:'crew',headcount:4,dayRateCents:9000,nightRateCents:5000},
    ])
    const captain=calculateCrewWage({halfDayUnits:23,nightCount:2,dayRateCents:14000,nightRateCents:10000})
    const worker=calculateCrewWage({halfDayUnits:23,nightCount:2,dayRateCents:9000,nightRateCents:5000})
    expect({captain,worker,total:captain+worker*4}).toEqual({
      captain:181000,
      worker:113500,
      total:635000,
    })
  })

  it('renders half-day units without floating point storage',()=>{
    expect([formatHalfDayUnits(22),formatHalfDayUnits(23),formatHalfDayUnits(1)]).toEqual(['11','11.5','0.5'])
  })

  it('retains template rates as a crew settlement snapshot',()=>{
    const settlement=createCrewSettlement({
      id:'crew-1',workerId:'w1',workerNameSnapshot:'Captain Lee',role:'captain',
      halfDayUnits:23,nightCount:2,templateId:'tpl-978',dayRateCents:50000,nightRateCents:30000,
    })
    expect(settlement).toMatchObject({grossWageCents:635000,dayRateCents:50000,nightRateCents:30000,balanceCents:635000})
  })
})

describe('vessel trip settlement rules',()=>{
  it('calculates profit from income less direct expenses and accrued crew wages',()=>{
    expect(calculateTripSettlement({incomeCents:2500000,expenseCents:400000,crewWageCents:635000,crewAdvanceCents:100000,crewPaidCents:200000}))
      .toEqual({profitCents:1465000,crewOutstandingCents:335000})
  })

  it('does not count advances or crew payments as expenses twice',()=>{
    const before=calculateTripSettlement({incomeCents:1000000,expenseCents:100000,crewWageCents:600000,crewAdvanceCents:0,crewPaidCents:0})
    const after=calculateTripSettlement({incomeCents:1000000,expenseCents:100000,crewWageCents:600000,crewAdvanceCents:200000,crewPaidCents:150000})
    expect([before.profitCents,after.profitCents,after.crewOutstandingCents]).toEqual([300000,300000,250000])
  })

  it('rejects an advance greater than the accrued wage',()=>{
    expect(validateCrewSettlement(createCrewSettlement({
      id:'c1',workerId:'w1',workerNameSnapshot:'Crew One',role:'crew',halfDayUnits:2,nightCount:0,
      templateId:'t1',dayRateCents:50000,nightRateCents:0,advanceCents:60000,
    }))).toContain('Advance cannot exceed gross wage.')
  })

  it('rejects fractional half-day units and negative night counts',()=>{
    expect(validateCrewSettlement({...createCrewSettlement({
      id:'c1',workerId:'w1',workerNameSnapshot:'Crew One',role:'crew',halfDayUnits:2,nightCount:0,
      templateId:'t1',dayRateCents:50000,nightRateCents:0,
    }),halfDayUnits:2.5,nightCount:-1})).toEqual(expect.arrayContaining([
      'Days must use whole half-day units.','Night count must be a non-negative whole number.',
    ]))
  })

  it('rejects a payment above the crew outstanding balance',()=>{
    const crew=createCrewSettlement({id:'c1',workerId:'w1',workerNameSnapshot:'Crew One',role:'crew',
      halfDayUnits:2,nightCount:0,templateId:'t1',dayRateCents:50000,nightRateCents:0})
    expect(()=>addCrewPayment(crew,100001)).toThrow('Payment exceeds outstanding crew wage.')
  })

  it('voiding a payment restores the outstanding balance while retaining its audit record',()=>{
    const crew=createCrewSettlement({id:'c1',workerId:'w1',workerNameSnapshot:'Crew One',role:'crew',
      halfDayUnits:4,nightCount:0,templateId:'t1',dayRateCents:50000,nightRateCents:0})
    const paid=addCrewPayment(crew,75000)
    const payment:VesselCrewPayment={id:'p1',tripId:'trip-1',crewSettlementId:'c1',workerId:'w1',
      workerNameSnapshot:'Crew One',paymentType:'settlement',amountCents:75000,method:'cash',paymentDate:'2026-07-15',
      reference:'',note:'',voided:false,voidReason:null}
    expect(voidCrewPayment(paid,payment,'wrong amount')).toMatchObject({
      settlement:{paidCents:0,balanceCents:100000},
      payment:{id:'p1',voided:true,voidReason:'wrong amount'},
    })
  })

  it('prevents voided payment records from being voided twice',()=>{
    const crew=createCrewSettlement({id:'c1',workerId:'w1',workerNameSnapshot:'Crew One',role:'crew',
      halfDayUnits:2,nightCount:0,templateId:'t1',dayRateCents:50000,nightRateCents:0})
    const payment:VesselCrewPayment={id:'p1',tripId:'trip-1',crewSettlementId:'c1',workerId:'w1',
      workerNameSnapshot:'Crew One',paymentType:'settlement',amountCents:50000,method:'cash',paymentDate:'2026-07-15',
      reference:'',note:'',voided:true,voidReason:'wrong amount'}
    expect(()=>voidCrewPayment(crew,payment,'again')).toThrow('This crew payment is already voided.')
  })

  it('records an advance separately from final crew payments',()=>{
    const crew=createCrewSettlement({id:'c1',workerId:'w1',workerNameSnapshot:'Crew One',role:'crew',
      halfDayUnits:4,nightCount:0,templateId:'t1',dayRateCents:50000,nightRateCents:0})
    expect(addCrewPayment(crew,25000,'advance')).toMatchObject({advanceCents:25000,paidCents:0,balanceCents:75000})
  })
})

describe('vessel trip lifecycle',()=>{
  it('normalizes trip snapshots and notes without changing money values',()=>{
    expect(normalizeTripInput({...trip(),tripCode:' T-978 ',vesselCodeSnapshot:' 978 ',vesselNameSnapshot:' Boat 978 ',notes:' note '}))
      .toMatchObject({tripCode:'T-978',vesselCodeSnapshot:'978',vesselNameSnapshot:'Boat 978',notes:'note'})
  })

  it('requires vessel, trip dates, integer cents, and return after departure',()=>{
    expect(validateTripInput(trip({vesselId:'',departureDate:'2026-07-20',returnDate:'2026-07-10',incomeCents:1.5,expenseCents:-1})))
      .toEqual(expect.arrayContaining([
        'Select a Vessel.','Return date cannot be earlier than departure date.',
        'Income must be a non-negative integer number of cents.','Expenses must be a non-negative integer number of cents.',
      ]))
  })

  it('keeps a voided trip and records a meaningful reason',()=>{
    expect(voidVesselTrip(trip({status:'confirmed'}),' trip cancelled ')).toMatchObject({
      id:'trip-1',status:'voided',voidReason:'trip cancelled',
    })
  })

  it('does not allow voiding a trip with active crew payments',()=>{
    expect(()=>voidVesselTrip(trip({status:'settled',crewPaidCents:10000}),'trip cancelled'))
      .toThrow('Void active crew advances and payments before voiding this trip.')
  })

  it('requires a three-character void reason',()=>{
    expect(()=>voidVesselTrip(trip({status:'confirmed'}),'no')).toThrow('Void reason must be 3 to 100 characters.')
  })

  it('settles a confirmed trip only after all crew wages are accounted for',()=>{
    expect(settleVesselTrip(trip({status:'confirmed',crewWageCents:635000,crewAdvanceCents:100000,crewPaidCents:535000})))
      .toMatchObject({status:'settled',revision:2})
  })

  it('rejects settlement while crew wages remain outstanding',()=>{
    expect(()=>settleVesselTrip(trip({status:'confirmed',crewWageCents:635000,crewPaidCents:500000})))
      .toThrow('All crew wages must be paid or advanced before settlement.')
  })

  it('locks payment voids after the trip is settled',()=>{
    expect(()=>assertCrewPaymentCanBeVoided(trip({status:'settled'})))
      .toThrow('Crew payments can only be voided before trip settlement.')
  })
})
