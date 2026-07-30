import { useEffect,useMemo,useState,type FormEvent } from 'react'
import { Link,useNavigate,useParams } from 'react-router-dom'
import type { Vessel } from '../lib/purchasing'
import {
  calculateCrewWage,formatHalfDayUnits,type VesselCrewSettlement,type VesselTrip,type VesselWageTemplate,
} from '../lib/vesselTrips'
import type { Worker } from '../types'
import { loadVessels } from '../services/purchaseMasterData'
import { loadWorkers } from '../services/workers'
import {
  addVesselCrewSettlement,addVesselTripEntry,confirmVesselTrip,createVesselCrewPayment,createVesselTrip,
  loadVesselTripBundle,loadVesselWageTemplates,settleVesselTripRecord,voidVesselCrewPaymentRecord,
  voidVesselTripEntry,voidVesselTripRecord,
  type VesselTripBundle,
} from '../services/vesselTrips'

const emptyTrip=():VesselTrip=>({id:'',tripCode:'',vesselId:'',vesselCodeSnapshot:'',vesselNameSnapshot:'',
  departureDate:'',returnDate:'',status:'draft',incomeCents:0,expenseCents:0,crewWageCents:0,
  crewAdvanceCents:0,crewPaidCents:0,profitCents:0,notes:'',revision:1,voidReason:null})
const money=(cents:number)=>`RM ${(cents/100).toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2})}`
const cents=(value:string)=>Math.round(Number(value||0)*100)
const today=()=>new Date().toISOString().slice(0,10)

interface Props {
  bundleLoader?:(id:string)=>Promise<VesselTripBundle>;vesselLoader?:()=>Promise<Vessel[]>
  workerLoader?:()=>Promise<Worker[]>;templateLoader?:()=>Promise<VesselWageTemplate[]>
  creator?:(value:VesselTrip)=>Promise<VesselTrip>
}

export function VesselTripPage({bundleLoader=loadVesselTripBundle,vesselLoader=loadVessels,workerLoader=loadWorkers,
  templateLoader=loadVesselWageTemplates,creator=createVesselTrip}:Props){
  const {tripId}=useParams(),isNew=!tripId,navigate=useNavigate()
  const [bundle,setBundle]=useState<VesselTripBundle|null>(null),[value,setValue]=useState(emptyTrip())
  const [vessels,setVessels]=useState<Vessel[]>([]),[workers,setWorkers]=useState<Worker[]>([]),[templates,setTemplates]=useState<VesselWageTemplate[]>([])
  const [error,setError]=useState(''),[busy,setBusy]=useState(false)
  useEffect(()=>{void Promise.all([vesselLoader(),workerLoader(),templateLoader(),isNew?Promise.resolve(null):bundleLoader(tripId!)])
    .then(([vesselRows,workerRows,templateRows,loaded])=>{setVessels(vesselRows);setWorkers(workerRows.filter(item=>item.active));setTemplates(templateRows)
      if(loaded){setBundle(loaded);setValue(loaded.trip)}}).catch(()=>setError('Vessel Trip data could not be loaded.'))},
  [isNew,tripId,bundleLoader,vesselLoader,workerLoader,templateLoader])
  async function create(event:FormEvent){event.preventDefault();setBusy(true);setError('')
    try{const saved=await creator({...value,tripCode:value.tripCode||`TRIP-${value.vesselCodeSnapshot}-${value.departureDate.replaceAll('-','')}`})
      navigate(`/vessel-trips/${saved.id}`)}catch(problem){setError(problem instanceof Error?problem.message:'Vessel Trip was not created.')}finally{setBusy(false)}}
  function selectVessel(id:string){const selected=vessels.find(item=>item.id===id);setValue(current=>({...current,vesselId:id,
    vesselCodeSnapshot:selected?.vesselCode??'',vesselNameSnapshot:selected?.displayName??''}))}
  async function reload(){if(tripId){const loaded=await bundleLoader(tripId);setBundle(loaded);setValue(loaded.trip)}}
  const due=value.crewWageCents-value.crewAdvanceCents-value.crewPaidCents
  return <main><header><p className="eyebrow">CCM Fishery</p><h1>{isNew?'New Vessel Trip':value.tripCode||'Vessel Trip'}</h1>
    <Link className="page-link" to="/vessel-trips">← Vessel Trips</Link></header>
    {error&&<p className="error" role="alert">{error}</p>}
    {isNew?<form className="master-form trip-form" onSubmit={create}>
      <label>Vessel<select value={value.vesselId} onChange={e=>selectVessel(e.target.value)}><option value="">Select Vessel</option>
        {vessels.filter(item=>item.active).map(item=><option value={item.id} key={item.id}>{item.vesselCode} · {item.displayName}</option>)}</select></label>
      <label>Trip code<input value={value.tripCode} placeholder="Auto-generated if blank" onChange={e=>setValue({...value,tripCode:e.target.value})}/></label>
      <label>Departure date<input type="date" value={value.departureDate} onChange={e=>setValue({...value,departureDate:e.target.value})}/></label>
      <label>Return date<input type="date" value={value.returnDate} onChange={e=>setValue({...value,returnDate:e.target.value})}/></label>
      <label>Notes<textarea value={value.notes} onChange={e=>setValue({...value,notes:e.target.value})}/></label>
      <button className="primary-action" disabled={busy}>{busy?'Creating…':'Create Vessel Trip'}</button>
    </form>:bundle&&<><section className="trip-summary-grid">
      <article><small>Vessel</small><strong>{value.vesselCodeSnapshot}</strong><span>{value.vesselNameSnapshot}</span></article>
      <article><small>Dates</small><strong>{value.departureDate}</strong><span>to {value.returnDate}</span></article>
      <article><small>Trip profit</small><strong>{money(value.profitCents)}</strong><span>Income {money(value.incomeCents)} − expenses {money(value.expenseCents)} − crew {money(value.crewWageCents)}</span></article>
      <article><small>Crew outstanding</small><strong>{money(due)}</strong><span>Advances {money(value.crewAdvanceCents)} · paid {money(value.crewPaidCents)}</span></article>
    </section>
    {value.status==='draft'&&<div className="trip-actions"><TripEntryForm tripId={tripId!} saved={reload}/><CrewForm tripId={tripId!} workers={workers.filter(item=>item.department==='vessel')} templates={templates} vesselCode={value.vesselCodeSnapshot} saved={reload}/>
      <button className="primary-action" onClick={()=>void confirmVesselTrip(tripId!).then(reload).catch(problem=>setError(problem.message))}>Confirm Vessel Trip</button></div>}
    <section><h2>Crew settlement</h2><div className="master-card-list">{bundle.crew.map(item=><CrewCard key={item.id} trip={value} crew={item} payments={bundle.payments} saved={reload} report={setError}/>)}</div></section>
    <section><h2>Income and expenses</h2><div className="purchase-list">{bundle.entries.map(item=><article className={`purchase-row ${item.voided?'payment-voided':''}`} key={item.id}>
      <div><small>{item.date} · {item.type}</small><strong>{item.category}</strong><span>{item.voided?`Voided: ${item.voidReason}`:item.note||'—'}</span></div>
      <div><b>{money(item.amountCents)}</b>{value.status==='draft'&&!item.voided&&<button className="danger-action" onClick={()=>{const reason=window.prompt('Void entry reason');if(reason)void voidVesselTripEntry(item,reason).then(reload).catch(problem=>setError(problem.message))}}>Void entry</button>}</div></article>)}</div></section>
    {value.status==='confirmed'&&due===0&&<button className="primary-action master-add" onClick={()=>void settleVesselTripRecord(tripId!).then(reload).catch(problem=>setError(problem.message))}>Complete Trip Settlement</button>}
    {value.status!=='voided'&&<button className="danger-action" onClick={()=>{const reason=window.prompt('Void reason');if(reason)void voidVesselTripRecord(tripId!,reason).then(reload).catch(problem=>setError(problem.message))}}>Void Vessel Trip</button>}
    </>}
  </main>
}

function TripEntryForm({tripId,saved}:{tripId:string;saved:()=>Promise<void>}){
  const [type,setType]=useState<'income'|'expense'>('income'),[category,setCategory]=useState('Catch sales'),[amount,setAmount]=useState(''),[date,setDate]=useState(today())
  async function submit(event:FormEvent){event.preventDefault();await addVesselTripEntry(tripId,{type,category,amountCents:cents(amount),date,note:''});setAmount('');await saved()}
  return <form className="inline-entry-form" onSubmit={submit}><h2>Add income / expense</h2>
    <label>Type<select value={type} onChange={e=>setType(e.target.value as 'income'|'expense')}><option value="income">Income</option><option value="expense">Expense</option></select></label>
    <label>Category<input value={category} onChange={e=>setCategory(e.target.value)}/></label><label>Date<input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label>
    <label>Amount (RM)<input inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)}/></label><button>Add Entry</button>
  </form>
}

function CrewForm({tripId,workers,templates,vesselCode,saved}:{tripId:string;workers:Worker[];templates:VesselWageTemplate[];vesselCode:string;saved:()=>Promise<void>}){
  const defaults=templates.find(item=>item.vesselCode===vesselCode)??templates[0]
  const [workerId,setWorkerId]=useState(''),[role,setRole]=useState<'captain'|'crew'>('crew'),[halfDayUnits,setHalfDayUnits]=useState(0)
  const [nightCount,setNightCount]=useState(0)
  const gross=useMemo(()=>defaults?calculateCrewWage({halfDayUnits,nightCount,dayRateCents:defaults.dayRateCents,nightRateCents:defaults.nightRateCents}):0,[defaults,halfDayUnits,nightCount])
  async function submit(event:FormEvent){event.preventDefault();const worker=workers.find(item=>item.id===workerId);if(!worker||!defaults)return
    await addVesselCrewSettlement(tripId,{id:'',workerId,workerNameSnapshot:worker.name,role,halfDayUnits,nightCount,templateId:defaults.id,
      dayRateCents:defaults.dayRateCents,nightRateCents:defaults.nightRateCents,advanceCents:0});setWorkerId('');await saved()}
  return <form className="inline-entry-form" onSubmit={submit}><h2>Add crew wage</h2>
    <label>Crew member<select value={workerId} onChange={e=>setWorkerId(e.target.value)}><option value="">Select Worker</option>{workers.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    <label>Role<select value={role} onChange={e=>setRole(e.target.value as 'captain'|'crew')}><option value="captain">Captain</option><option value="crew">Crew</option></select></label>
    <label>Days<select value={halfDayUnits} onChange={e=>setHalfDayUnits(Number(e.target.value))}>{Array.from({length:61},(_,index)=><option value={index} key={index}>{formatHalfDayUnits(index)}</option>)}</select></label>
    <label>Nights<input type="number" min="0" step="1" value={nightCount} onChange={e=>setNightCount(Number(e.target.value))}/></label>
    <p className="calculated-total">Gross {money(gross)}</p><button>Add Crew Wage</button>
  </form>
}

function CrewCard({trip,crew,payments,saved,report}:{trip:VesselTrip;crew:VesselCrewSettlement;payments:VesselTripBundle['payments'];saved:()=>Promise<void>;report:(value:string)=>void}){
  const [amount,setAmount]=useState(''),[method,setMethod]=useState<'cash'|'bank'|'other'>('cash')
  const [paymentType,setPaymentType]=useState<'advance'|'settlement'>(trip.status==='draft'?'advance':'settlement')
  async function pay(event:FormEvent){event.preventDefault();try{await createVesselCrewPayment({tripId:trip.id,crewSettlementId:crew.id,amountCents:cents(amount),
    paymentType,method,paymentDate:today(),reference:'',note:''});setAmount('');await saved()}catch(problem){report(problem instanceof Error?problem.message:'Crew payment failed.')}}
  return <article className="master-card"><div className="master-card-heading"><div><small>{crew.role}</small><h3>{crew.workerNameSnapshot}</h3></div><b>{money(crew.balanceCents)} due</b></div>
    <p>{formatHalfDayUnits(crew.halfDayUnits)} days · {crew.nightCount} nights</p><p>Gross {money(crew.grossWageCents)}</p>
    <p>Advance {money(crew.advanceCents)} · Paid {money(crew.paidCents)}</p>
    {['draft','confirmed'].includes(trip.status)&&crew.balanceCents>0&&<form className="crew-pay-form" onSubmit={pay}>
      <label>Payment type<select value={paymentType} onChange={e=>setPaymentType(e.target.value as typeof paymentType)}>
        {trip.status==='draft'&&<option value="advance">Advance</option>}{trip.status==='confirmed'&&<><option value="settlement">Settlement</option><option value="advance">Advance</option></>}</select></label>
      <label>Amount (RM)<input value={amount} onChange={e=>setAmount(e.target.value)}/></label>
      <label>Method<select value={method} onChange={e=>setMethod(e.target.value as typeof method)}><option value="cash">Cash</option><option value="bank">Bank</option><option value="other">Other</option></select></label><button>Pay Crew</button></form>}
    {payments.filter(item=>item.crewSettlementId===crew.id).map(payment=><div className={`payment-history ${payment.voided?'voided':''}`} key={payment.id}>
      <span>{payment.paymentDate} · {payment.paymentType} · {money(payment.amountCents)} · {payment.method}</span>{payment.voided?<small>Voided: {payment.voidReason}</small>:trip.status==='settled'?<small>Settlement locked</small>:
      <button onClick={()=>{const reason=window.prompt('Void payment reason');if(reason)void voidVesselCrewPaymentRecord(payment,reason).then(saved).catch(problem=>report(problem.message))}}>Void payment</button>}</div>)}
  </article>
}
