import { cleanup,render,screen,waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter,Route,Routes } from 'react-router-dom'
import { afterEach,describe,expect,it,vi } from 'vitest'
import type { BusinessPartner } from '../lib/masterData'
import type { PurchaseCategory,PurchaseReceipt,Vessel } from '../lib/purchasing'
import { PurchaseCategoriesPage } from './PurchaseCategoriesPage'
import { PurchaseMonthlyPage } from './PurchaseMonthlyPage'
import { PurchaseReceiptPage } from './PurchaseReceiptPage'
import { PurchasesPage } from './PurchasesPage'
import { VesselsPage } from './VesselsPage'

const supplier:BusinessPartner={id:'s1',partnerCode:'BP-SUPPLY1',displayName:'Ocean Supply',legalName:'',supplier:true,customer:false,active:true,
  phone:'',registrationNo:'',paymentTermsDays:0,notes:'',inactiveBy:null}
const vessel:Vessel={id:'v1',vesselCode:'2031',displayName:'Boat 2031',defaultSupplierId:'s1',defaultSupplierNameSnapshot:'Ocean Supply',active:true,notes:''}
const category:PurchaseCategory={id:'fish_head',categoryCode:'fish_head',displayName:'鱼头',active:true,order:0,notes:''}
const receipt=(overrides:Partial<PurchaseReceipt>={}):PurchaseReceipt=>({id:'r1',receiptCode:'RC-12345678',receiptDate:'2026-07-30',monthKey:'2026-07',
  externalSlipNo:'C3988',supplierId:'s1',supplierCodeSnapshot:'BP-SUPPLY1',supplierNameSnapshot:'Ocean Supply',vesselId:'v1',
  vesselCodeSnapshot:'2031',vesselNameSnapshot:'Boat 2031',status:'confirmed',lineCount:1,totalBasketCount:2,totalWeightGrams:12500,
  totalAmountCents:1538,paidCents:0,paymentStatus:'unpaid',notes:'',duplicateAcknowledged:false,lines:[],...overrides})

afterEach(()=>{cleanup();vi.restoreAllMocks()})
describe('purchase receiving pages',()=>{
  it('does not initialize defaults until the administrator clicks and confirms',async()=>{
    const initializer=vi.fn().mockResolvedValue([category]);vi.spyOn(window,'confirm').mockReturnValue(true)
    render(<MemoryRouter><PurchaseCategoriesPage loader={async()=>[]} initializer={initializer}/></MemoryRouter>)
    expect(await screen.findByRole('button',{name:'Initialize CCM default categories'})).toBeInTheDocument()
    expect(initializer).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button',{name:'Initialize CCM default categories'}))
    await waitFor(()=>expect(initializer).toHaveBeenCalledOnce())
  })

  it('deactivates a vessel while retaining it in the list',async()=>{
    const deactivator=vi.fn().mockResolvedValue(undefined)
    render(<MemoryRouter><VesselsPage loader={async()=>[vessel]} supplierLoader={async()=>[supplier]} deactivator={deactivator}/></MemoryRouter>)
    await userEvent.click(await screen.findByRole('button',{name:'Deactivate'}))
    await waitFor(()=>expect(deactivator).toHaveBeenCalledWith(vessel))
    expect(await screen.findByText('Inactive')).toBeInTheDocument()
  })

  it('automatically selects quick-added supplier, vessel, and category',async()=>{
    const newSupplier={...supplier,id:'s2',partnerCode:'BP-NEW00001',displayName:'New Supplier'}
    const newVessel={...vessel,id:'v2',vesselCode:'833',displayName:'Boat 833'}
    const newCategory={...category,id:'fish_meal',categoryCode:'fish_meal',displayName:'鱼仔'}
    render(<MemoryRouter initialEntries={['/purchases/new']}><Routes><Route path="/purchases/new" element={<PurchaseReceiptPage
      receiptsLoader={async()=>[]} supplierLoader={async()=>[]} vesselLoader={async()=>[]} categoryLoader={async()=>[]}
      supplierCreator={async()=>newSupplier} vesselCreator={async()=>newVessel} categoryCreator={async()=>newCategory}/>}/></Routes></MemoryRouter>)
    const user=userEvent.setup()
    const supplierSelect=await screen.findByLabelText('Supplier')
    await user.selectOptions(supplierSelect,'__add')
    await user.type(screen.getByLabelText('Display name'),'New Supplier')
    await user.click(screen.getByRole('button',{name:'Save Business Partner'}))
    await waitFor(()=>expect(supplierSelect).toHaveValue('s2'))
    const vesselSelect=screen.getByLabelText('Vessel')
    await user.selectOptions(vesselSelect,'__add')
    await user.type(screen.getByLabelText('Vessel code'),'833')
    await user.type(screen.getByLabelText('Display name'),'Boat 833')
    await user.click(screen.getByRole('button',{name:'Save Vessel'}))
    await waitFor(()=>expect(vesselSelect).toHaveValue('v2'))
    await user.click(screen.getByRole('button',{name:'Add Line'}))
    const [categorySelect,secondCategorySelect]=screen.getAllByLabelText('Category')
    await user.selectOptions(categorySelect,'__add')
    await user.type(screen.getByLabelText('Category code'),'fish_meal')
    await user.type(screen.getByLabelText('Display name'),'鱼仔')
    await user.click(screen.getByRole('button',{name:'Save Category'}))
    await waitFor(()=>expect(categorySelect).toHaveValue('fish_meal'))
    expect(secondCategorySelect).toHaveValue('')
  })

  it('filters voided purchases out of confirmed amount and outstanding summaries',async()=>{
    render(<MemoryRouter><PurchasesPage loader={async()=>[receipt(),receipt({id:'r2',status:'voided',totalAmountCents:90000})]}/></MemoryRouter>)
    expect((await screen.findAllByText('RM 15.38')).length).toBeGreaterThan(0)
    expect(screen.queryByText('RM 900.00')).toBeInTheDocument()
    const summary=screen.getByText('Outstanding').parentElement
    expect(summary).toHaveTextContent('RM 15.38')
    await userEvent.selectOptions(screen.getByLabelText('Status'),'unpaid')
    expect(screen.getAllByRole('link').filter(link=>link.getAttribute('href')?.startsWith('/purchases/r'))).toHaveLength(1)
  })

  it('prints a supplier statement and includes confirmed receipts only',async()=>{
    const printer=vi.fn()
    render(<MemoryRouter><PurchaseMonthlyPage receiptLoader={async()=>[receipt(),receipt({id:'draft',status:'draft'})]}
      supplierLoader={async()=>[{...supplier,active:false}]} printer={printer}/></MemoryRouter>)
    expect(await screen.findByText('RC-12345678')).toBeInTheDocument()
    expect(screen.getByText('Confirmed').parentElement).toHaveTextContent('1')
    await userEvent.click(screen.getByRole('button',{name:'Print Supplier Statement'}))
    expect(printer).toHaveBeenCalledOnce()
  })

  it('exposes payment history and voids an incorrect payment before receipt void',async()=>{
    const paymentVoider=vi.fn().mockResolvedValue(undefined);vi.spyOn(window,'prompt').mockReturnValue('wrong payment')
    const withLine=receipt({paidCents:500,paymentStatus:'partial',draftVersion:1,lineIds:['l1'],lines:[{id:'l1',lineNo:1,categoryId:'fish_head',
      categoryCodeSnapshot:'fish_head',categoryNameSnapshot:'鱼头',basketCount:2,weightGrams:12500,unitPriceCentsPerKg:123,amountCents:1538,notes:''}]})
    render(<MemoryRouter initialEntries={['/purchases/r1']}><Routes><Route path="/purchases/:receiptId" element={<PurchaseReceiptPage
      receiptLoader={async()=>withLine} receiptsLoader={async()=>[withLine]} supplierLoader={async()=>[supplier]} vesselLoader={async()=>[vessel]}
      categoryLoader={async()=>[category]} paymentLoader={async()=>[{id:'p1',paymentGroupId:'g1',receiptId:'r1',receiptCode:'RC-12345678',
        supplierId:'s1',supplierNameSnapshot:'Ocean Supply',amountCents:500,method:'bank',paymentDate:'2026-07-30',reference:'TX1',
        note:'',createdBy:'u1',voided:false,voidReason:null,voidedBy:null}]} paymentVoider={paymentVoider}/>}/></Routes></MemoryRouter>)
    await userEvent.click(await screen.findByText('Payment History (1)'))
    await userEvent.click(screen.getByRole('button',{name:'Void Payment'}))
    await waitFor(()=>expect(paymentVoider).toHaveBeenCalled())
    expect(screen.getByText('Voided: wrong payment')).toBeInTheDocument()
  })
})
