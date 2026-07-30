import { cleanup,render,screen,waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter,Route,Routes } from 'react-router-dom'
import { afterEach,describe,expect,it,vi } from 'vitest'
import type { Vessel } from '../lib/purchasing'
import type { VesselCrewSettlement,VesselTrip,VesselWageTemplate } from '../lib/vesselTrips'
import { VesselTripPage } from './VesselTripPage'
import { VesselTripsPage } from './VesselTripsPage'
import { VesselWageTemplatesPage } from './VesselWageTemplatesPage'

const vessel:Vessel={id:'v978',vesselCode:'978',displayName:'Boat 978',defaultSupplierId:'',defaultSupplierNameSnapshot:'',active:true,notes:''}
const trip:VesselTrip={id:'t1',tripCode:'TRIP-978-20260701',vesselId:'v978',vesselCodeSnapshot:'978',vesselNameSnapshot:'Boat 978',
  departureDate:'2026-07-01',returnDate:'2026-07-13',status:'draft',incomeCents:2500000,expenseCents:400000,
  crewWageCents:635000,crewAdvanceCents:100000,crewPaidCents:200000,profitCents:1465000,notes:'',revision:1,voidReason:null}
const template:VesselWageTemplate={id:'tpl978',vesselId:'v978',vesselCode:'978',name:'978 Standard',dayRateCents:50000,nightRateCents:30000,active:true}
const crew:VesselCrewSettlement={id:'c1',workerId:'w1',workerNameSnapshot:'Captain Lee',role:'captain',templateId:'tpl978',
  halfDayUnits:23,nightCount:2,dayRateCents:50000,nightRateCents:30000,grossWageCents:635000,advanceCents:100000,paidCents:200000,balanceCents:335000}
afterEach(cleanup)

describe('Vessel Trip pages',()=>{
  it('shows trip profit and crew outstanding without double-counting payments',async()=>{
    render(<MemoryRouter><VesselTripsPage loader={async()=>[trip]}/></MemoryRouter>)
    expect(await screen.findByText('TRIP-978-20260701')).toBeInTheDocument()
    expect(screen.getByText('Profit RM 14,650.00')).toBeInTheDocument()
    expect(screen.getByText('Crew due RM 3,350.00')).toBeInTheDocument()
  })

  it('creates a trip with vessel snapshots',async()=>{
    const creator=vi.fn(async(value:VesselTrip)=>({...value,id:'new-trip'}))
    render(<MemoryRouter initialEntries={['/vessel-trips/new']}><Routes>
      <Route path="/vessel-trips/new" element={<VesselTripPage vesselLoader={async()=>[vessel]} workerLoader={async()=>[]} templateLoader={async()=>[template]} creator={creator}/>}/>
      <Route path="/vessel-trips/:tripId" element={<p>Saved trip</p>}/>
    </Routes></MemoryRouter>)
    const user=userEvent.setup()
    await user.selectOptions(await screen.findByLabelText('Vessel'),'v978')
    await user.type(screen.getByLabelText('Departure date'),'2026-07-01')
    await user.type(screen.getByLabelText('Return date'),'2026-07-13')
    await user.click(screen.getByRole('button',{name:'Create Vessel Trip'}))
    await waitFor(()=>expect(creator).toHaveBeenCalledWith(expect.objectContaining({
      vesselId:'v978',vesselCodeSnapshot:'978',vesselNameSnapshot:'Boat 978',
    })))
  })

  it('shows the 11.5-day and two-night crew wage as RM6,350',async()=>{
    render(<MemoryRouter initialEntries={['/vessel-trips/t1']}><Routes>
      <Route path="/vessel-trips/:tripId" element={<VesselTripPage bundleLoader={async()=>({trip,crew:[crew],entries:[],payments:[]})}
        vesselLoader={async()=>[vessel]} workerLoader={async()=>[]} templateLoader={async()=>[template]}/>}/>
    </Routes></MemoryRouter>)
    expect(await screen.findByText('11.5 days · 2 nights')).toBeInTheDocument()
    expect(screen.getByText('Gross RM 6,350.00')).toBeInTheDocument()
  })

  it('lists reviewed 978 and 833 wage templates',async()=>{
    render(<MemoryRouter><VesselWageTemplatesPage loader={async()=>[
      template,{...template,id:'tpl833',vesselCode:'833',name:'833 Standard'},
    ]}/></MemoryRouter>)
    expect(await screen.findByText('978 Standard')).toBeInTheDocument()
    expect(screen.getByText('833 Standard')).toBeInTheDocument()
    expect(screen.getAllByText('Day RM 500.00 · Night RM 300.00')).toHaveLength(2)
  })
})
