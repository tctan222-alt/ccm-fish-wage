import { act,cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react'
import { Link,MemoryRouter,Route,Routes,useLocation } from 'react-router-dom'
import { afterEach,expect,it,vi } from 'vitest'
import { RetailReceiptPage } from './RetailSalesPage'
import type { RetailSale } from '../lib/retailSales'

const service=vi.hoisted(()=>({load:vi.fn(),save:vi.fn(),update:vi.fn()}))
vi.mock('../services/retailSales',()=>({loadRetailSale:service.load,saveRetailSale:service.save,updateRetailSale:service.update}))
vi.mock('../lib/retailInvoicePdf',()=>({createRetailInvoicePdf:async()=>new File(['%PDF-1.4'],'invoice.pdf',{type:'application/pdf'})}))
const sale:RetailSale={id:'sale-one',businessDate:'03/10/2026',dateSortKey:20261003,vendorName:'阿明',remark:'',
  lines:[{fishId:'fish',chineseName:'金线',malayName:'Kerisi',weightDeciKg:10,unitPriceCents:200,amountCents:200}],totalAmountCents:200}
function Location(){return <span aria-label="route">{useLocation().pathname}</span>}
function mount(){render(<MemoryRouter initialEntries={['/retail-sales/history/sale-one']}><Location/><Link to="/retail-sales/history/sale-two">另单</Link><Routes><Route path="/retail-sales/history/:saleId" element={<RetailReceiptPage/>}/></Routes></MemoryRouter>)}
afterEach(()=>{cleanup();vi.resetAllMocks()})

it('shows loading, a read failure, and retry success for the same invoice without any mutation',async()=>{
  let reject!:(reason:Error)=>void
  service.load.mockImplementationOnce(()=>new Promise((_resolve,fail)=>{reject=fail})).mockResolvedValueOnce(sale)
  mount();expect(screen.getByRole('status')).toHaveTextContent('正在载入结算单')
  await act(async()=>reject(new Error('读取被拒绝')))
  expect(screen.getByRole('alert')).toHaveTextContent('读取被拒绝')
  expect(screen.queryByText(/正在载入结算单/)).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button',{name:'重新载入 Reload'}))
  await screen.findByText('小贩 Vendor：阿明')
  expect(service.load.mock.calls).toEqual([['sale-one'],['sale-one']])
  expect(screen.getByLabelText('route')).toHaveTextContent('/retail-sales/history/sale-one')
  expect(service.save).not.toHaveBeenCalled();expect(service.update).not.toHaveBeenCalled()
  expect(screen.getByRole('button',{name:'打印 Print'})).toBeInTheDocument()
  expect(screen.getByRole('button',{name:'PDF / 分享 PDF / Share'})).toBeInTheDocument()
})

it('shows not-found separately without an endless network retry',async()=>{
  service.load.mockRejectedValueOnce(Object.assign(new Error('找不到此现金结算单。 Cash invoice not found.'),{code:'retail/not-found'}))
  mount();await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('找不到此现金结算单'))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(screen.queryByRole('button',{name:'重新载入 Reload'})).not.toBeInTheDocument()
  expect(service.load).toHaveBeenCalledOnce()
})

it('ignores a stale invoice response after the URL changes and retries the current saleId',async()=>{
  let resolve!:(value:RetailSale)=>void
  service.load.mockImplementationOnce(()=>new Promise(done=>{resolve=done})).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({...sale,id:'sale-two',vendorName:'第二张'})
  mount();fireEvent.click(screen.getByRole('link',{name:'另单'}));await screen.findByRole('alert')
  await act(async()=>resolve(sale))
  expect(screen.queryByText('小贩 Vendor：阿明')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button',{name:'重新载入 Reload'}))
  await screen.findByText('小贩 Vendor：第二张')
  expect(service.load.mock.calls).toEqual([['sale-one'],['sale-two'],['sale-two']])
})
