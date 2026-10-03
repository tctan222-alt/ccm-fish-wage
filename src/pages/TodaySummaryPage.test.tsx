import { cleanup,fireEvent,render,screen,waitFor,within } from '@testing-library/react'
import { useLayoutEffect } from 'react'
import { Link,MemoryRouter,Route,Routes,useLocation } from 'react-router-dom'
import { afterEach,describe,expect,it,vi } from 'vitest'
import { TodaySummaryPage } from './TodaySummaryPage'
import { malaysiaDateKey } from '../lib/wage'
import type { DailyWageData,StoredWageEntry } from '../services/wages'

const entry=(overrides:Partial<StoredWageEntry>={}):StoredWageEntry=>({
  id:'basket-1',dateKey:'2026-10-03',workerId:'worker-1',workerName:'阿红母女',
  weightKg:74,rateRm:'0.12',wageRm:'8.88',createdBy:'u1',deleted:false,...overrides,
})
const timestamp=(iso:string)=>({toDate:()=>new Date(iso),toMillis:()=>new Date(iso).getTime()})

function deferred<T>(){
  let resolve!:(value:T)=>void
  let reject!:(error:Error)=>void
  const promise=new Promise<T>((success,failure)=>{resolve=success;reject=failure})
  return {promise,resolve,reject}
}

function Location(){
  const location=useLocation()
  return <output aria-label="当前地址">{location.pathname}{location.search}</output>
}

function PrintSafetyObserver({onNavigation}:{onNavigation:(search:string,printDisabled:boolean,hasOldReport:boolean)=>void}){
  const {search}=useLocation()
  useLayoutEffect(()=>{
    const button=[...document.querySelectorAll('button')].find(item=>item.textContent==='打印 Print')
    onNavigation(search,button?.disabled??true,document.querySelector('.daily-report-print')!==null)
  },[search,onNavigation])
  return null
}

afterEach(()=>{cleanup();vi.restoreAllMocks()})

describe('切鱼头工钱当日汇总',()=>{
  it('返回工钱录入入口指向真实切鱼头工钱页面，保留月度及 Master Data 入口',()=>{
    render(<MemoryRouter><TodaySummaryPage loader={async()=>({entries:[],voids:[]})}/></MemoryRouter>)
    expect(screen.getByRole('link',{name:'← 返回工钱录入'})).toHaveAttribute('href','/fish-head-wages')
    expect(screen.getByRole('link',{name:'月度汇总'})).toHaveAttribute('href','/monthly')
    expect(screen.getByRole('link',{name:'基本资料'})).toHaveAttribute('href','/master-data')
  })
  it.each([
    ['重量错误','Wrong kg'],['工人错误','Wrong worker'],['重复记录','Duplicate entry'],
  ])('中文原因 %s 保存原有稳定值 %s',async(label,persisted)=>{
    const original=entry()
    const loader=vi.fn(async()=>({entries:[original],voids:[]}))
    const voider=vi.fn(async()=>{})
    render(<MemoryRouter initialEntries={['/daily?date=2026-10-03']}><TodaySummaryPage loader={loader} voider={voider}/></MemoryRouter>)
    const report=await screen.findByLabelText('每日工钱明细')
    fireEvent.click(within(report).getByRole('button',{name:'作废',hidden:true}))
    const dialog=screen.getByRole('dialog',{name:'作废这笔记录？'})
    fireEvent.click(within(dialog).getByLabelText(label))
    fireEvent.click(within(dialog).getByRole('button',{name:'确认作废'}))
    await waitFor(()=>expect(voider).toHaveBeenCalledWith(original,persisted))
  })
  it('其他作废原因仍要求非空，保存 trim 后原文；失败保留记录及重试入口',async()=>{
    const original=entry()
    const loader=vi.fn(async()=>({entries:[original],voids:[]}))
    const voider=vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(undefined)
    render(<MemoryRouter initialEntries={['/daily?date=2026-10-03']}><TodaySummaryPage loader={loader} voider={voider}/></MemoryRouter>)
    const report=await screen.findByLabelText('每日工钱明细')
    fireEvent.click(within(report).getByRole('button',{name:'作废',hidden:true}))
    const dialog=screen.getByRole('dialog',{name:'作废这笔记录？'})
    fireEvent.click(within(dialog).getByLabelText('其他'))
    expect(within(dialog).getByRole('button',{name:'确认作废'})).toBeDisabled()
    fireEvent.change(within(dialog).getByLabelText(/其他原因/),{target:{value:'  录入重复确认  '}})
    fireEvent.click(within(dialog).getByRole('button',{name:'确认作废'}))
    expect(await screen.findByRole('alert')).toHaveTextContent('作废失败，记录未修改。请检查网络后重试。')
    expect(voider).toHaveBeenCalledWith(original,'录入重复确认')
    expect(screen.getByLabelText('每日工钱明细')).toHaveTextContent('RM8.88')
    expect(screen.getByRole('button',{name:'打印 Print'})).toBeDisabled()
    fireEvent.click(within(dialog).getByRole('button',{name:'确认作废'}))
    await waitFor(()=>expect(voider).toHaveBeenCalledTimes(2))
    await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
  it('取消作废不会写入或改变报表',async()=>{
    const loader=vi.fn(async()=>({entries:[entry()],voids:[]}))
    const voider=vi.fn(async()=>{})
    render(<MemoryRouter initialEntries={['/daily?date=2026-10-03']}><TodaySummaryPage loader={loader} voider={voider}/></MemoryRouter>)
    const report=await screen.findByLabelText('每日工钱明细')
    fireEvent.click(within(report).getByRole('button',{name:'作废',hidden:true}))
    expect(screen.getByRole('button',{name:'打印 Print'})).toBeDisabled()
    fireEvent.click(screen.getByRole('button',{name:'取消'}))
    expect(voider).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button',{name:'打印 Print'})).toBeEnabled()
    expect(screen.getByLabelText('每日工钱打印报表')).toHaveTextContent('RM8.88')
  })
  it('打印异常显示可理解错误，可以直接重按打印且保留同步 user gesture',async()=>{
    const print=vi.spyOn(window,'print').mockImplementationOnce(()=>{throw new Error('blocked')}).mockImplementation(()=>{})
    const loader=vi.fn(async()=>({entries:[entry()],voids:[]}))
    render(<MemoryRouter initialEntries={['/daily?date=2026-10-03']}><TodaySummaryPage loader={loader}/></MemoryRouter>)
    await waitFor(()=>expect(screen.getByRole('button',{name:'打印 Print'})).toBeEnabled())
    fireEvent.click(screen.getByRole('button',{name:'打印 Print'}))
    expect(screen.getByRole('alert')).toHaveTextContent('无法打开打印界面，请重试或检查浏览器设置。')
    expect(screen.getByRole('button',{name:'打印 Print'})).toBeEnabled()
    fireEvent.click(screen.getByRole('button',{name:'打印 Print'}))
    expect(print).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(loader).toHaveBeenCalledTimes(1)
  })
  it('加载和空记录清楚区分，均不能打印',async()=>{
    const pending=deferred<DailyWageData>()
    render(<MemoryRouter initialEntries={['/daily?date=2026-10-03']}><TodaySummaryPage loader={()=>pending.promise}/></MemoryRouter>)
    expect(screen.getByText('正在载入每日工钱明细…')).toBeInTheDocument()
    expect(screen.queryByText('此日期没有有效工钱记录。')).not.toBeInTheDocument()
    expect(screen.getByRole('button',{name:'打印 Print'})).toBeDisabled()
    expect(screen.queryByLabelText('每日工钱打印报表')).not.toBeInTheDocument()
    pending.resolve({entries:[],voids:[]})
    expect(await screen.findByText('此日期没有有效工钱记录。')).toBeInTheDocument()
    expect(screen.queryByText('正在载入每日工钱明细…')).not.toBeInTheDocument()
    expect(screen.getByRole('button',{name:'打印 Print'})).toBeDisabled()
  })
  it('URL 导航日期也立即载入该日，迟到的旧请求不会覆盖新日记录',async()=>{
    const old=deferred<DailyWageData>()
    const selected=deferred<DailyWageData>()
    const loader=vi.fn((date:string)=>date==='2026-10-03'?old.promise:selected.promise)
    render(<MemoryRouter initialEntries={['/daily?date=2026-10-03']}><TodaySummaryPage loader={loader}/><Link to="/daily?date=2026-09-30">查看九月日期</Link></MemoryRouter>)
    fireEvent.click(screen.getByRole('link',{name:'查看九月日期'}))
    expect(screen.getByLabelText('日期')).toHaveValue('2026-09-30')
    expect(loader).toHaveBeenCalledWith('2026-09-30')
    selected.resolve({entries:[entry({dateKey:'2026-09-30',workerName:'九月工人'})],voids:[]})
    expect(await screen.findByRole('heading',{name:'九月工人'})).toBeInTheDocument()
    old.resolve({entries:[entry({workerName:'迟到的旧日期工人'})],voids:[]})
    await waitFor(()=>expect(screen.getByRole('button',{name:'打印 Print'})).toBeEnabled())
    expect(screen.queryByRole('heading',{name:'迟到的旧日期工人'})).not.toBeInTheDocument()
    expect(screen.getByLabelText('每日工钱打印报表')).toHaveTextContent('九月工人')
  })
  it('每篮按记录时间然后 id 确定排序，序号与实际保存记录一致',async()=>{
    const same=timestamp('2026-10-03T00:11:00Z')
    const loader=vi.fn(async()=>({entries:[
      entry({id:'z',weightKg:76,wageRm:'9.12',createdAt:same}),
      entry({id:'late',weightKg:80,wageRm:'9.60',createdAt:timestamp('2026-10-03T00:12:00Z')}),
      entry({id:'a',createdAt:same}),
    ],voids:[]}))
    render(<MemoryRouter initialEntries={['/daily?date=2026-10-03']}><TodaySummaryPage loader={loader}/></MemoryRouter>)
    const report=await screen.findByLabelText('每日工钱打印报表')
    const rows=within(report).getAllByRole('row',{hidden:true}).slice(1)
    expect(rows.map(row=>within(row).getAllByRole('cell',{hidden:true})[0].textContent)).toEqual(['1','2','3'])
    expect(rows.map(row=>within(row).getAllByRole('cell',{hidden:true})[1].textContent)).toEqual(['74kg','76kg','80kg'])
  })
  it('切换日期首个 render 就禁止打印旧日数据，而非等待新查询 effect',async()=>{
    const next=deferred<DailyWageData>()
    const loader=vi.fn().mockResolvedValueOnce({entries:[entry()],voids:[]}).mockReturnValueOnce(next.promise)
    const observed=vi.fn()
    render(<MemoryRouter initialEntries={['/daily?date=2026-10-03']}><TodaySummaryPage loader={loader}/><PrintSafetyObserver onNavigation={observed}/></MemoryRouter>)
    await waitFor(()=>expect(screen.getByRole('button',{name:'打印 Print'})).toBeEnabled())
    fireEvent.change(screen.getByLabelText('日期'),{target:{value:'2026-10-02'}})
    expect(observed).toHaveBeenLastCalledWith('?date=2026-10-02',true,false)
    expect(screen.getByText('正在载入每日工钱明细…')).toBeInTheDocument()
    next.resolve({entries:[entry({dateKey:'2026-10-02',workerName:'新日期工人'})],voids:[]})
    expect(await screen.findByRole('heading',{name:'新日期工人'})).toBeInTheDocument()
    expect(screen.getByRole('button',{name:'打印 Print'})).toBeEnabled()
  })
  it('中文作废确认继续保存既有英文 reason value，重读后主报表排除记录并保留审计历史',async()=>{
    const original=entry()
    const loader=vi.fn().mockResolvedValueOnce({entries:[original],voids:[]}).mockResolvedValueOnce({entries:[],voids:[{
      ...original,id:'audit-1',entryId:original.id,voidReason:'Wrong rate',voidedBy:'u1',
    }]})
    const voider=vi.fn(async()=>{})
    render(<MemoryRouter initialEntries={['/daily?date=2026-10-03']}><TodaySummaryPage loader={loader} voider={voider}/></MemoryRouter>)
    const report=await screen.findByLabelText('每日工钱明细')
    fireEvent.click(within(report).getByRole('button',{name:'作废',hidden:true}))
    const dialog=screen.getByRole('dialog',{name:'作废这笔记录？'})
    fireEvent.click(within(dialog).getByLabelText('单价错误'))
    fireEvent.click(within(dialog).getByRole('button',{name:'确认作废'}))
    await waitFor(()=>expect(voider).toHaveBeenCalledWith(original,'Wrong rate'))
    expect(await screen.findByText('此日期没有有效工钱记录。')).toBeInTheDocument()
    expect(screen.getByText('作废记录 (1)')).toBeInTheDocument()
    expect(screen.getByText('单价错误')).toBeInTheDocument()
    expect(screen.queryByLabelText('每日工钱打印报表')).not.toBeInTheDocument()
    expect(screen.getByRole('button',{name:'打印 Print'})).toBeDisabled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
  it('同步打印全部工人每篮，即使屏幕明细折叠，保留实际小计与总计且排除作废记录',async()=>{
    const print=vi.spyOn(window,'print').mockImplementation(()=>{})
    const loader=vi.fn(async()=>({entries:[
      entry({createdAt:timestamp('2026-10-03T00:11:00Z')}),
      entry({id:'basket-2',weightKg:76,wageRm:'9.12',createdAt:timestamp('2026-10-03T00:12:00Z')}),
      entry({id:'basket-3',workerId:'worker-2',workerName:'大妹',weightKg:1,rateRm:'0.15',wageRm:'0.15'}),
      entry({id:'deleted-basket',workerName:'作废工人',weightKg:99,wageRm:'11.88',deleted:true}),
    ],voids:[]}))
    render(<MemoryRouter initialEntries={['/daily?date=2026-10-03']}><TodaySummaryPage loader={loader}/></MemoryRouter>)
    const button=await screen.findByRole('button',{name:'打印 Print'})
    await waitFor(()=>expect(button).toBeEnabled())
    const report=screen.getByLabelText('每日工钱打印报表')
    expect(report.querySelector('details')).toBeNull()
    expect(report.querySelector('button')).toBeNull()
    expect(within(report).getAllByRole('row',{hidden:true})).toHaveLength(5)
    expect(within(report).getByText('08:11 am')).toBeInTheDocument()
    expect(within(report).getByText('RM8.88')).toBeInTheDocument()
    expect(within(report).getByText('RM9.12')).toBeInTheDocument()
    expect(report).toHaveTextContent('阿红母女')
    expect(report).toHaveTextContent('大妹')
    expect(report).toHaveTextContent('150kg')
    expect(report).toHaveTextContent('RM18.00')
    expect(report).toHaveTextContent('151kg')
    expect(report).toHaveTextContent('RM18.15')
    expect(report).not.toHaveTextContent('作废工人')
    const grand=within(report).getByLabelText('每日总计')
    expect(grand).toHaveTextContent('工人数2')
    expect(grand).toHaveTextContent('总篮数3')
    expect(grand).toHaveTextContent('总重量151kg')
    expect(grand).toHaveTextContent('总工钱RM18.15')
    expect(document.querySelectorAll('.daily-report-screen details[open]')).toHaveLength(0)
    fireEvent.click(button)
    expect(print).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('heading',{name:'切鱼头工钱每日明细'})).toBeInTheDocument()
    expect(screen.getByText('03/10/2026')).toBeInTheDocument()
  })
  it('读取失败显示错误而不是空记录，原页重试会重新载入',async()=>{
    const loader=vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({entries:[],voids:[]})
    render(<MemoryRouter initialEntries={['/daily?date=2026-10-03']}><TodaySummaryPage loader={loader}/></MemoryRouter>)
    expect(await screen.findByRole('alert')).toHaveTextContent('无法载入每日工钱记录，请检查网络后重试。')
    expect(screen.getByRole('button',{name:'打印 Print'})).toBeDisabled()
    expect(screen.queryByText('此日期没有有效工钱记录。')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button',{name:'重试'}))
    expect(await screen.findByText('此日期没有有效工钱记录。')).toBeInTheDocument()
    expect(loader).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
  it.each(['2026-02-30','2026-13-01','not-a-date'])('URL 无效日期 %s 不查询或格式化错误日期，并显示明确提示',async invalid=>{
    const loader=vi.fn(async()=>({entries:[],voids:[]}))
    render(<MemoryRouter initialEntries={[`/daily?date=${invalid}`]}><TodaySummaryPage loader={loader}/></MemoryRouter>)
    await waitFor(()=>expect(loader).toHaveBeenCalledWith(malaysiaDateKey()))
    expect(screen.getByLabelText('日期')).toHaveValue(malaysiaDateKey())
    expect(screen.getByText('日期无效，已显示今天的记录。')).toBeInTheDocument()
  })
  it('选择日期立即加载对应日期并更新 URL，刷新可以保留日期',async()=>{
    const loader=vi.fn(async()=>({entries:[],voids:[]}))
    const view=render(<MemoryRouter initialEntries={['/daily?date=2026-10-03']}><TodaySummaryPage loader={loader}/><Location/></MemoryRouter>)
    await waitFor(()=>expect(loader).toHaveBeenCalledWith('2026-10-03'))
    fireEvent.change(screen.getByLabelText('日期'),{target:{value:'2026-09-30'}})
    await waitFor(()=>expect(loader).toHaveBeenCalledWith('2026-09-30'))
    expect(screen.getByLabelText('当前地址')).toHaveTextContent('/daily?date=2026-09-30')
    expect(screen.getByText('30/09/2026')).toBeInTheDocument()
    view.unmount()
    render(<MemoryRouter initialEntries={['/daily?date=2026-09-30']}><TodaySummaryPage loader={loader}/></MemoryRouter>)
    expect(screen.getByLabelText('日期')).toHaveValue('2026-09-30')
  })
  it('跟随所选日期读取，并兼容没有新日期字段的旧工资记录',async()=>{
    const loader=vi.fn(async()=>({entries:[{
      id:'legacy-wage',dateKey:'2026-07-31',workerId:'w1',workerName:'旧工人',weightKg:80,rateRm:'0.12',wageRm:'9.60',createdBy:'u1',deleted:false,
    }],voids:[]}))
    render(<MemoryRouter initialEntries={['/today?date=2026-07-31']}><Routes><Route path="/today" element={<TodaySummaryPage loader={loader}/>}/></Routes></MemoryRouter>)
    expect(await screen.findByRole('heading',{name:'切鱼头工钱每日明细'})).toBeInTheDocument()
    expect(loader).toHaveBeenCalledWith('2026-07-31')
    expect(await screen.findByRole('heading',{name:'旧工人'})).toBeInTheDocument()
    const report=screen.getByLabelText('每日工钱明细')
    expect(within(report).getByText('80kg',{selector:'td'})).toBeInTheDocument()
    expect(within(report).getByText('RM0.12')).toBeInTheDocument()
    expect(within(report).getByText('RM9.60',{selector:'td'})).toBeInTheDocument()
  })
})
