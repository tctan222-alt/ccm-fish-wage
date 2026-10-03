import { beforeEach,expect,it,vi } from 'vitest'
import { loadWageMonthSummaryData } from './monthClosing'
const mocks=vi.hoisted(()=>({getDocs:vi.fn(),getDoc:vi.fn()}))
vi.mock('../firebase',()=>({firebaseConfigured:true,auth:{currentUser:{uid:'local'}},db:{}}))
vi.mock('firebase/firestore',()=>({
  doc:(parent:{path?:string},...parts:string[])=>({path:[parent.path,...parts].filter(Boolean).join('/')}),
  collection:(parent:{path?:string},...parts:string[])=>({path:[parent.path,...parts].filter(Boolean).join('/')}),
  query:(ref:unknown)=>ref,where:vi.fn(),getDocs:mocks.getDocs,getDoc:mocks.getDoc,
  getDocsFromServer:vi.fn(),runTransaction:vi.fn(),serverTimestamp:vi.fn(),writeBatch:vi.fn(),
}))
beforeEach(()=>vi.clearAllMocks())
it('normal closed-month summaries read existing statements, retain legacy data, and do not query payments',async()=>{
  const month={status:'closed',workerCount:1,statementIds:['worker'],closeVersion:2,paidCents:888}
  mocks.getDoc.mockResolvedValue({exists:()=>true,data:()=>month})
  mocks.getDocs.mockImplementation(async(ref:{path:string})=>{
    if(ref.path.includes('/payments'))throw new Error('must not depend on payments')
    return {docs:[{id:'worker',data:()=>({workerName:'Ah Mei'})}]}
  })
  const result=await loadWageMonthSummaryData('2026-10')
  expect(result.month?.paidCents).toBe(888);expect(result.statements).toHaveLength(1);expect(result.payments).toEqual([])
  expect(mocks.getDocs).toHaveBeenCalledTimes(1)
  expect(mocks.getDocs.mock.calls[0][0].path).toBe('fishHeadWageMonths/2026-10/statements')
})
