import { cleanup,fireEvent,render,screen,within } from '@testing-library/react'
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest'

const firestore=vi.hoisted(()=>({getDocs:vi.fn()}))

vi.mock('./firebase',()=>({auth:{},db:{},firebaseConfigured:true}))
vi.mock('firebase/auth',()=>({
  onAuthStateChanged:vi.fn((_auth:unknown,callback:(user:{uid:string})=>void)=>{
    callback({uid:'test-admin'})
    return vi.fn()
  }),
  signOut:vi.fn(),
  signInWithEmailAndPassword:vi.fn(),
}))
vi.mock('firebase/firestore',()=>({
  collection:(_db:unknown,path:string)=>({path}),
  where:(field:string,operator:string,value:unknown)=>({field,operator,value}),
  query:(reference:unknown,...constraints:unknown[])=>({reference,constraints}),
  getDocs:firestore.getDocs,
  getDocsFromServer:vi.fn(),
  doc:vi.fn(),
  serverTimestamp:vi.fn(),
  writeBatch:vi.fn(),
}))

import App from './App'

interface FirestoreQuery {
  reference:{path:string}
  constraints:{field:string;operator:string;value:string}[]
}

beforeEach(()=>{
  vi.spyOn(window,'confirm').mockReturnValue(true)
  firestore.getDocs.mockReset()
  firestore.getDocs.mockImplementation(async(query:FirestoreQuery)=>{
    if(query.reference.path==='workers')return {docs:[{
      id:'w1',data:()=>({name:'每日明细工人',active:true,order:1,department:'fish_head'}),
    }]}
    if(query.reference.path==='fishHeadWageVoids')return {docs:[]}
    expect(query.reference.path).toBe('fishHeadWageEntries')
    expect(query.constraints).toEqual([{field:'dateKey',operator:'==',value:'2026-07-31'}])
    return {docs:[{
      id:'historical-entry',data:()=>({
        dateKey:'2026-07-31',workerId:'w1',workerName:'每日明细工人',
        weightKg:80,rateRm:'0.12',wageRm:'9.60',createdBy:'test-admin',deleted:false,
      }),
    }]}
  })
})

afterEach(()=>{
  cleanup()
  window.history.replaceState(null,'','/')
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe('daily wage route compatibility',()=>{
  it.each(['/daily','/today'])('%s opens the actual daily detail page with its saved URL date',async(route)=>{
    window.history.replaceState(null,'',`${route}?date=2026-07-31`)
    render(<App/>)

    expect(await screen.findByRole('heading',{name:'切鱼头工钱每日明细'})).toBeInTheDocument()
    expect(await screen.findByRole('heading',{name:'每日明细工人'})).toBeInTheDocument()
    expect(screen.getByLabelText('日期')).toHaveValue('2026-07-31')
    const report=within(screen.getByRole('region',{name:'每日工钱明细'}))
    fireEvent.click(report.getByText('查看 1 篮明细'))
    const rows=within(report.getByRole('table',{name:'每篮工钱明细'})).getAllByRole('row')
    expect(rows).toHaveLength(2)
    const basket=within(rows[1])
    expect(basket.getByRole('cell',{name:'80kg'})).toBeInTheDocument()
    expect(basket.getByRole('cell',{name:'RM0.12'})).toBeInTheDocument()
    expect(basket.getByRole('cell',{name:'RM9.60'})).toBeInTheDocument()
    expect(window.location.pathname).toBe(route)
  })

  it('opens canonical daily details from wage entry using the newly selected business date',async()=>{
    window.history.replaceState(null,'','/fish-head-wages')
    render(<App/>)
    await screen.findByRole('button',{name:'每日明细工人'})

    fireEvent.change(screen.getByLabelText('日期'),{target:{value:'2026-07-31'}})
    fireEvent.click(screen.getByRole('link',{name:'每日明细'}))

    expect(await screen.findByRole('heading',{name:'切鱼头工钱每日明细'})).toBeInTheDocument()
    expect(await screen.findByRole('heading',{name:'每日明细工人'})).toBeInTheDocument()
    expect(screen.getByLabelText('日期')).toHaveValue('2026-07-31')
    expect(window.location.pathname+window.location.search).toBe('/daily?date=2026-07-31')
  })
})
