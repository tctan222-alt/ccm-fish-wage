import { useEffect,useState } from 'react'
import { Link } from 'react-router-dom'
import type { VesselTrip } from '../lib/vesselTrips'
import { loadVesselTrips } from '../services/vesselTrips'

const money=(cents:number)=>`RM ${(cents/100).toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2})}`

export function VesselTripsPage({loader=loadVesselTrips}:{loader?:()=>Promise<VesselTrip[]>}){
  const [items,setItems]=useState<VesselTrip[]|null>(null),[error,setError]=useState('')
  useEffect(()=>{void loader().then(setItems).catch(()=>{setItems([]);setError('Vessel Trips could not be loaded.')})},[loader])
  return <main><header><p className="eyebrow">CCM Fishery</p><h1>Vessel Trips</h1>
    <div className="header-links"><Link className="page-link" to="/">← Wage Entry</Link><Link className="page-link" to="/vessel-wage-templates">Wage Templates</Link></div></header>
    <Link className="primary-action master-add" to="/vessel-trips/new">New Vessel Trip</Link>
    {error&&<p className="error" role="alert">{error}</p>}
    {items===null?<p className="notice">Loading Vessel Trips…</p>:items.length===0?<p className="notice">No Vessel Trips yet.</p>:
      <div className="purchase-list">{items.map(item=>{const due=item.crewWageCents-item.crewAdvanceCents-item.crewPaidCents
        return <Link to={`/vessel-trips/${item.id}`} className="purchase-row" key={item.id}>
          <div><small>{item.departureDate} → {item.returnDate}</small><strong>{item.tripCode}</strong>
            <span>{item.vesselCodeSnapshot} · {item.vesselNameSnapshot}</span></div>
          <div className="trip-list-totals"><span>Profit {money(item.profitCents)}</span><span>Crew due {money(due)}</span>
            <b className={`record-status ${item.status}`}>{item.status}</b></div>
        </Link>})}</div>}
  </main>
}
