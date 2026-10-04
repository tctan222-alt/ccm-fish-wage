import { cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react'
import { MemoryRouter,Route,Routes } from 'react-router-dom'
import { afterEach,describe,expect,it,vi } from 'vitest'
import { PurchaseSettlementPage } from './PurchaseSettlementPage'
import { buildWeighingEntry,newWeighingSession } from '../lib/weighing'

afterEach(()=>{cleanup();window.localStorage.clear()})

describe('settlement stable read error and retry',()=>{
  it('distinguishes an unstable source from no data and can retry in the same page',async()=>{
    const session={...newWeighingSession({id:'source',productType:'fish_head',weighingDate:'01/10/2026',vesselId:'v833',vesselCodeSnapshot:'833',vesselNameSnapshot:'833'}),status:'completed' as const,revision:11,completedAt:new Date('2026-10-01T00:00:00Z')}
    const entry=buildWeighingEntry({id:'entry-a',sessionId:'source',productType:'fish_head',fishSpeciesId:'hong_mu_lin',fishSpecies:{id:'hong_mu_lin',speciesCode:'hong_mu_lin',displayName:'红目林'},fishMealQuality:null,entryMode:'individual',sequenceNo:1,weightGrams:80000,remark:'',recordedAt:new Date('2026-10-01T02:00:00Z'),recordedAtClient:'2026-10-01T10:00:00+08:00',recordedBy:'u1'})
    const loader=vi.fn().mockRejectedValueOnce(new Error('称重资料正在修改，请稍后重新载入结单。')).mockResolvedValue({session,entries:[entry],actions:[]})
    const saver=vi.fn(async draft=>({...draft,draftId:'fish_head_session_source',revision:1}))
    render(<MemoryRouter initialEntries={['/fish-head-settlement/source']}><Routes><Route path="/fish-head-settlement/:sessionId" element={<PurchaseSettlementPage productType="fish_head" vesselLoader={async()=>[]} bundleLoader={loader} draftLoader={async()=>null} draftSaver={saver} now={()=>new Date('2026-10-03T00:00:00Z')}/>}/></Routes></MemoryRouter>)
    expect(await screen.findByRole('alert')).toHaveTextContent('称重资料正在修改')
    expect(screen.queryByText('当前没有称重资料，不能结单。')).not.toBeInTheDocument()
    expect(screen.queryByText('RM 0.00')).not.toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.queryByRole('button',{name:'保存结单草稿'})).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button',{name:'重新载入结单'}))
    expect(await screen.findByRole('table')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText('80 kg')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button',{name:'保存结单草稿'}))
    await waitFor(()=>expect(saver).toHaveBeenCalledTimes(1))
    expect(saver.mock.calls[0][0]).toMatchObject({sourceSessionId:'source',sourceSessionRevision:11,totalAmountCents:22000})
  })
  it('does not display stale tuple metadata when the legacy source changed during discovery',async()=>{
    const discovered=newWeighingSession({id:'source',productType:'fish_head',weighingDate:'01/10/2026',vesselId:'v833',vesselCodeSnapshot:'833',vesselNameSnapshot:'833'})
    const stable={...discovered,weighingDate:'02/10/2026',vesselId:'v978',vesselCodeSnapshot:'978',revision:11}
    const draftLoader=vi.fn(async()=>null)
    render(<MemoryRouter><PurchaseSettlementPage productType="fish_head" today={()=>'01/10/2026'} vesselLoader={async()=>[{id:'v833',vesselCode:'833',displayName:'833',active:true,order:0,notes:'',defaultSupplierId:'',defaultSupplierNameSnapshot:''}]} sourceLoader={async()=>({session:stable,bundle:{session:stable,entries:[]}})} draftLoader={draftLoader}/></MemoryRouter>)
    expect(await screen.findByRole('alert')).toHaveTextContent('日期或船号已变更')
    expect(draftLoader).not.toHaveBeenCalled()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.queryByText('当前没有称重资料，不能结单。')).not.toBeInTheDocument()
  })
})
