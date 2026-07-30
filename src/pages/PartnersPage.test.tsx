import { cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach,describe,expect,it,vi } from 'vitest'
import { PartnersPage } from './PartnersPage'
import type { BusinessPartner } from '../lib/masterData'

const partners:BusinessPartner[]=[
  {id:'p1',partnerCode:'BP-11111111',displayName:'Ocean Supply',legalName:'Ocean Supply Sdn Bhd',supplier:true,customer:false,active:true,phone:'0123',registrationNo:'REG1',paymentTermsDays:30,notes:'',inactiveBy:null},
  {id:'p2',partnerCode:'BP-22222222',displayName:'Harbour Trading',legalName:'',supplier:true,customer:true,active:false,phone:'',registrationNo:'',paymentTermsDays:0,notes:'',inactiveBy:'admin'},
]

afterEach(()=>cleanup())

describe('business partners page',()=>{
  it('shows active summaries and keeps inactive partners in management',async()=>{
    render(<MemoryRouter><PartnersPage loader={async()=>partners}/></MemoryRouter>)
    expect(await screen.findByText('Ocean Supply')).toBeInTheDocument()
    expect(screen.getByText('Harbour Trading')).toBeInTheDocument()
    expect(screen.getByText('Active Suppliers').parentElement).toHaveTextContent('1')
    expect(screen.queryByRole('button',{name:/delete/i})).not.toBeInTheDocument()
  })

  it('filters partners by search and inactive status',async()=>{
    render(<MemoryRouter><PartnersPage loader={async()=>partners}/></MemoryRouter>)
    await screen.findByText('Ocean Supply')
    fireEvent.change(screen.getByLabelText('Search partners'),{target:{value:'Harbour'}})
    expect(screen.queryByText('Ocean Supply')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Partner filter'),{target:{value:'inactive'}})
    expect(screen.getByText('Harbour Trading')).toBeInTheDocument()
  })

  it('warns on duplicate name and saves only after explicit confirmation',async()=>{
    const creator=vi.fn(async()=>({...partners[0],id:'p3'}))
    render(<MemoryRouter><PartnersPage loader={async()=>partners} creator={creator}/></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button',{name:'Add Business Partner'}))
    fireEvent.change(screen.getByLabelText('Display name'),{target:{value:'ocean supply'}})
    fireEvent.click(screen.getByLabelText('Supplier'))
    fireEvent.click(screen.getByRole('button',{name:'Save Business Partner'}))
    expect(await screen.findByRole('alert')).toHaveTextContent('same display name')
    expect(creator).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button',{name:'Save duplicate anyway'}))
    await waitFor(()=>expect(creator).toHaveBeenCalledOnce())
  })

  it('returns the new partner ID through the reusable form callback',async()=>{
    const saved=vi.fn()
    const creator=vi.fn(async()=>({...partners[0],id:'new-partner',displayName:'New Supplier'}))
    render(<MemoryRouter><PartnersPage loader={async()=>[]} creator={creator} onPartnerCreated={saved}/></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button',{name:'Add Business Partner'}))
    fireEvent.change(screen.getByLabelText('Display name'),{target:{value:'New Supplier'}})
    fireEvent.click(screen.getByLabelText('Supplier'))
    fireEvent.click(screen.getByRole('button',{name:'Save Business Partner'}))
    await waitFor(()=>expect(saved).toHaveBeenCalledWith('new-partner'))
  })
})
