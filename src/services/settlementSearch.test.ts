import { afterEach,describe,expect,it,vi } from 'vitest'
import { createSettlementPageLoader,loadSettlementPage,type ProjectedDocument,type StructuredQuery,type SettlementSearch } from './settlementSearch'

vi.mock('../firebase',()=>({app:{options:{projectId:'local-fixture'}},auth:{currentUser:{getIdToken:async()=> 'test-token'}}}))
const search:SettlementSearch={productType:'fish_head',from:'2026-09-20',to:'2026-10-03',vesselId:'',status:'all'}
const document=(id:string,fields:Record<string,string|number|boolean>):ProjectedDocument=>({name:`projects/local-fixture/databases/(default)/documents/weighingSessions/${id}`,
  fields:Object.fromEntries(Object.entries(fields).map(([key,value])=>[key,typeof value==='number'?{integerValue:String(value)}:typeof value==='boolean'?{booleanValue:value}:{stringValue:value}]))})
const session=(id:string,date='03/10/2026',overrides:Record<string,string|number|boolean>={})=>document(id,{weighingDate:date,monthKey:date.includes('/')?'10/2026':'2026-10',sessionCode:id,productType:'fish_head',status:'completed',vesselId:'v833',vesselCodeSnapshot:'833',revision:3,fishHeadWeightGrams:80500,fishHeadBasketCount:2,...overrides})
type Filter={fieldFilter:{field:{fieldPath:string};op:string;value:{stringValue?:string;referenceValue?:string;arrayValue?:{values:{stringValue?:string;referenceValue?:string}[]}}}}
function queryFixture(docs:ProjectedDocument[]){
  return vi.fn(async(query:StructuredQuery)=>{
    const collection=query.from[0].collectionId
    let result=docs.filter(doc=>doc.name.split('/').at(-2)===collection).filter(doc=>query.where.compositeFilter.filters.every(filter=>{
      const {field,op,value}=(filter as Filter).fieldFilter
      const actual=field.fieldPath==='__name__'?doc.name:doc.fields[field.fieldPath]?.stringValue
      const expected=value.stringValue??value.referenceValue
      return op==='IN'?value.arrayValue!.values.some(item=>(item.stringValue??item.referenceValue)===actual):op==='EQUAL'?actual===expected:op==='GREATER_THAN_OR_EQUAL'?actual!==undefined&&actual>=expected!:actual!==undefined&&actual<=expected!
    }))
    const sortField=query.orderBy[0]?.field.fieldPath
    if(sortField==='dateSortKey')result=result.filter(doc=>doc.fields.dateSortKey?.integerValue!==undefined)
    result.sort((a,b)=>sortField==='dateSortKey'?Number(b.fields.dateSortKey.integerValue)-Number(a.fields.dateSortKey.integerValue)||b.name.localeCompare(a.name):
      (b.fields.weighingDate?.stringValue??'').localeCompare(a.fields.weighingDate?.stringValue??'')||b.name.localeCompare(a.name))
    if(query.startAt){const index=result.findIndex(doc=>doc.name===query.startAt!.values[1].referenceValue);result=result.slice(index+1)}
    return result.slice(0,query.limit)
  })
}
afterEach(()=>vi.unstubAllGlobals())
describe('projected server settlement search',()=>{
  it.each(['fish_head','fish_meal'] as const)('runs a date-free %s vessel query with one numeric date stream and 25-row cursors',async(productType)=>{
    const days=[20261003,20260930,20260831]
    const docs=Array.from({length:61},(_,index)=>session(`vessel-${String(index).padStart(3,'0')}`,['03/10/2026','30/09/2026','2026-08-31'][index%3],{productType,dateSortKey:days[index%3]}))
    docs.push(session('other-vessel','04/10/2026',{productType,vesselId:'another',dateSortKey:20261004}),session('other-product','04/10/2026',{productType:productType==='fish_head'?'fish_meal':'fish_head',dateSortKey:20261004}))
    const run=queryFixture(docs),load=createSettlementPageLoader(run)
    const query={...search,mode:'vessel' as const,productType,from:'',to:'',vesselId:'v833'}
    const first=await load(query),savedCursor=JSON.stringify(first.cursor),second=await load(query,first.cursor),third=await load(query,second.cursor)
    expect([first.items.length,second.items.length,third.items.length]).toEqual([25,25,11])
    expect(new Set([...first.items,...second.items,...third.items].map(item=>item.id)).size).toBe(61)
    expect(third.cursor).toBeNull();expect(JSON.stringify(first.cursor)).toBe(savedCursor)
    const dates=[...first.items,...second.items,...third.items].map(item=>item.weighingDate)
    expect(dates.slice(0,21)).toEqual(Array(21).fill('03/10/2026'))
    const queries=run.mock.calls.map(([query])=>query).filter(query=>query.from[0].collectionId==='weighingSessions')
    expect(queries).toHaveLength(3)
    for(const query of queries){
      expect(query.limit).toBe(25)
      expect(query.orderBy[0].field.fieldPath).toBe('dateSortKey')
      expect(JSON.stringify(query.where)).not.toMatch(/monthKey|GREATER_THAN|LESS_THAN/)
      expect(query.select.fields.map(field=>field.fieldPath)).not.toContain('lines')
    }
  })
  it('requires a vessel in vessel mode, without validating unused date fields',async()=>{
    const load=createSettlementPageLoader(queryFixture([]))
    await expect(load({...search,mode:'vessel',from:'',to:'',vesselId:''})).rejects.toThrow('船号')
    expect((await load({...search,mode:'vessel',from:'not-a-date',to:'',vesselId:'inactive-historical'})).items).toEqual([])
  })
  it('projects finalized status/time in one batch, retaining formal amounts after source revision changes',async()=>{
    const docs=[session('draft'),session('final'),session('expired'),session('processed','03/10/2026',{status:'processed',processedReceiptId:'legacy'})]
    for(const [source,status,stamp] of [['draft','settlement_draft',''],['final','settlement_finalized',new Date().toISOString()],['expired','settlement_finalized',new Date(Date.now()-91*86400000).toISOString()]] as const){
      const header=document(`draft-${source}`,{sourceSessionId:source,sourceSessionRevision:source==='final'?2:3,productType:'fish_head',status,totalAmountCents:1234,voided:false})
      header.name=header.name.replace('/weighingSessions/','/purchaseSettlementDrafts/')
      if(stamp)header.fields.finalizedAt={timestampValue:stamp}
      docs.push(header)
    }
    const run=queryFixture(docs),page=await createSettlementPageLoader(run)(search)
    expect(page.items.find(item=>item.id==='draft')?.settlementState).toBe('draft')
    expect(page.items.find(item=>item.id==='final')).toMatchObject({settlementState:'finalized',totalAmountCents:1234})
    expect(page.items.find(item=>item.id==='expired')?.settlementState).toBe('locked')
    expect(page.items.find(item=>item.id==='processed')?.settlementState).toBe('legacy_processed')
    const headerQueries=run.mock.calls.map(([query])=>query).filter(query=>query.from[0].collectionId==='purchaseSettlementDrafts')
    expect(headerQueries).toHaveLength(1)
    expect(headerQueries[0].select.fields.map(field=>field.fieldPath)).toContain('finalizedAt')
    expect(headerQueries[0].select.fields.map(field=>field.fieldPath)).not.toContain('lines')
  })
  it.each(['fish_head','fish_meal'] as const)('keeps %s separate, filters date/status/vessel on the server and never reads source details',async productType=>{
    const docs=[session('match','03/10/2026',{productType}),session('too-old','19/09/2026',{productType}),session('other-product','03/10/2026',{productType:productType==='fish_head'?'fish_meal':'fish_head'}),session('other-vessel','03/10/2026',{productType,vesselId:'another'}),session('wrong-status','03/10/2026',{productType,status:'weighing'})]
    const run=queryFixture(docs),page=await createSettlementPageLoader(run)({...search,productType,vesselId:'v833',status:'completed'})
    expect(page.items.map(item=>item.id)).toEqual(['match'])
    for(const [query] of run.mock.calls){
      expect(query.select.fields.map(field=>field.fieldPath)).not.toContain('lines')
      expect(query.from[0].collectionId).not.toMatch(/entries|actions|species/i)
      if(query.from[0].collectionId==='weighingSessions'){
        expect(query.limit).toBe(25);expect(JSON.stringify(query.where)).toContain(productType)
        expect(JSON.stringify(query.where)).toContain('v833');expect(JSON.stringify(query.where)).toContain('GREATER_THAN_OR_EQUAL')
      }
    }
  })
  it('merges legacy ISO and canonical dates descending across month boundaries without dateSortKey',async()=>{
    const run=queryFixture([session('iso','2026-10-02'),session('oct','03/10/2026'),session('sep','30/09/2026',{monthKey:'09/2026'}),session('old-shape','2026-09-29',{monthKey:'2026-09'}),session('start','20/09/2026',{monthKey:'09/2026'})])
    const page=await createSettlementPageLoader(run)(search)
    expect(page.items.map(item=>item.id)).toEqual(['oct','iso','sep','old-shape','start'])
    expect(page.cursor).toBeNull()
  })
  it('paginates 61 mixed-format records without duplicates, omissions or mutating a previous cursor',async()=>{
    const docs=Array.from({length:61},(_,index)=>session(`s${String(index).padStart(3,'0')}`,index%2?'2026-10-03':'03/10/2026'))
    const run=queryFixture(docs),load=createSettlementPageLoader(run),first=await load(search),saved=JSON.stringify(first.cursor)
    const second=await load(search,first.cursor),third=await load(search,second.cursor)
    expect(first.items).toHaveLength(25);expect(second.items).toHaveLength(25);expect(third.items).toHaveLength(11)
    expect(new Set([...first.items,...second.items,...third.items].map(item=>item.id)).size).toBe(61)
    expect(third.cursor).toBeNull();expect(JSON.stringify(first.cursor)).toBe(saved)
  })
  it('does not scan older empty canonical months before returning a full recent ISO page from a large range',async()=>{
    const run=queryFixture(Array.from({length:26},(_,index)=>session(`recent-${index}`,'2026-10-03')))
    const page=await createSettlementPageLoader(run)({...search,from:'2000-01-01'})
    expect(page.items).toHaveLength(25)
    expect(run.mock.calls.filter(([query])=>query.from[0].collectionId==='weighingSessions')).toHaveLength(2)
  })
  it.each(['fish_head','fish_meal'] as const)('keeps full-month %s mixed formats disjoint, ordered and complete across pages',async productType=>{
    const docs=Array.from({length:61},(_,index)=>session(String(index).padStart(3,'0'),index%2?'2026-10-02':'03/10/2026',{productType}))
    const load=createSettlementPageLoader(queryFixture(docs)),query={...search,productType,from:'2026-10-01',to:'2026-10-31'}
    const items=[];let cursor=null
    do{const page=await load(query,cursor);items.push(...page.items);cursor=page.cursor}while(cursor)
    expect(items).toHaveLength(61);expect(new Set(items.map(item=>item.id)).size).toBe(61)
    expect(items.slice(0,31).every(item=>item.weighingDate==='03/10/2026')).toBe(true)
    expect(items.slice(31).every(item=>item.weighingDate==='2026-10-02')).toBe(true)
  })
  it.each(['fish_head','fish_meal'] as const)('keeps %s queries crossing 2000 disjoint from canonical day 20 and paginates without duplicates',async productType=>{
    const docs=Array.from({length:61},(_,index)=>session('century-'+String(index).padStart(3,'0'),index%2?'2026-10-19':'20/10/2026',{productType}))
    const load=createSettlementPageLoader(queryFixture(docs)),query={...search,productType,from:'1990-01-01',to:'2026-10-31'}
    const first=await load(query),second=await load(query,first.cursor),third=await load(query,second.cursor)
    const items=[...first.items,...second.items,...third.items]
    expect(items).toHaveLength(61);expect(new Set(items.map(item=>item.id)).size).toBe(61)
    expect(items.slice(0,31).every(item=>item.weighingDate==='20/10/2026')).toBe(true)
    expect(items.slice(31).every(item=>item.weighingDate==='2026-10-19')).toBe(true)
  })
  it.each([0,24])('bounds sparse large-range work with %i ISO results and a resumable cursor',async count=>{
    const run=queryFixture(Array.from({length:count},(_,index)=>session('recent-'+index,'2026-10-03')))
    const page=await createSettlementPageLoader(run)({...search,from:'2000-01-01'})
    expect(page.items).toHaveLength(count);expect(page.cursor).not.toBeNull()
    expect(run.mock.calls.filter(([query])=>query.from[0].collectionId==='weighingSessions').length).toBeLessThanOrEqual(7)
  })
  it('does not emit an older ISO row before unchecked newer canonical months',async()=>{
    const run=queryFixture([session('older','2025-01-10',{monthKey:'2025-01'}),session('newer','05/03/2026',{monthKey:'03/2026'})])
    const load=createSettlementPageLoader(run),query={...search,from:'2025-01-01'}
    const first=await load(query);expect(first.items).toEqual([]);expect(first.cursor).not.toBeNull()
    const second=await load(query,first.cursor);expect(second.items[0].id).toBe('newer')
  })
  it('uses only revision-matching bound draft monetary headers; stale and unbound amounts remain unknown',async()=>{
    const docs=[session('current'),session('stale'),session('legacy'),document('draft-current',{sourceSessionId:'current',sourceSessionRevision:3,productType:'fish_head',totalAmountCents:16502,receiptNo:'R-1',voided:false}),document('draft-stale',{sourceSessionId:'stale',sourceSessionRevision:2,productType:'fish_head',totalAmountCents:1,voided:false}),document('legacy-draft',{vesselId:'v833',totalAmountCents:99})]
    for(const doc of docs.slice(3))doc.name=doc.name.replace('/weighingSessions/','/purchaseSettlementDrafts/')
    const page=await createSettlementPageLoader(queryFixture(docs))(search)
    expect(page.items.find(item=>item.id==='current')).toMatchObject({totalAmountCents:16502,referenceNumber:'R-1'})
    expect(page.items.find(item=>item.id==='stale')?.totalAmountCents).toBeNull();expect(page.items.find(item=>item.id==='legacy')?.totalAmountCents).toBeNull()
  })
  it('batch-loads processed receipt amounts and preserves inactive vessel snapshots without Master reads',async()=>{
    const receipt=document('receipt',{totalAmountCents:12345,receiptCode:'PR-1'});receipt.name=receipt.name.replace('/weighingSessions/','/purchaseReceipts/')
    const run=queryFixture([session('done','03/10/2026',{status:'processed',vesselId:'inactive',vesselCodeSnapshot:'历史船',processedReceiptId:'receipt'}),receipt])
    const page=await createSettlementPageLoader(run)({...search,vesselId:'inactive'})
    expect(page.items[0]).toMatchObject({vesselCodeSnapshot:'历史船',totalAmountCents:12345,referenceNumber:'PR-1'})
    expect(run.mock.calls.filter(([query])=>query.from[0].collectionId==='purchaseReceipts')).toHaveLength(1)
  })
  it('rejects invalid range and a cursor belonging to different criteria',async()=>{
    const load=createSettlementPageLoader(queryFixture(Array.from({length:26},(_,index)=>session(String(index)))))
    await expect(load({...search,from:'2026-10-04'})).rejects.toThrow('开始日期')
    const first=await load(search)
    await expect(load({...search,vesselId:'another'},first.cursor)).rejects.toThrow('筛选已改变')
  })
  it('propagates service errors and respects cancellation',async()=>{
    await expect(createSettlementPageLoader(async()=>{throw new Error('index missing')})(search)).rejects.toThrow('index missing')
    const controller=new AbortController();controller.abort()
    await expect(createSettlementPageLoader(queryFixture([]))(search,null,controller.signal)).rejects.toMatchObject({name:'AbortError'})
  })
  it('calls the official read-only REST projection with the current authenticated token',async()=>{
    const fetchMock=vi.fn(async()=>({ok:true,json:async()=>[]}));vi.stubGlobal('fetch',fetchMock)
    await loadSettlementPage({...search,from:'2026-10-03'})
    expect(fetchMock.mock.calls[0]).toEqual([expect.stringContaining('/documents:runQuery'),expect.objectContaining({method:'POST',headers:expect.objectContaining({Authorization:'Bearer test-token'})})])
    const request=fetchMock.mock.calls[0] as unknown as [string,{body:string}]
    expect(JSON.parse(request[1].body).structuredQuery.select.fields).not.toContainEqual({fieldPath:'lines'})
  })
  it.each([400,401,403,500])('returns a visible Chinese diagnostic for HTTP %s without disclosing credentials',async status=>{
    vi.stubGlobal('fetch',async()=>({ok:false,status}))
    await expect(loadSettlementPage({...search,from:'2026-10-03'})).rejects.toThrow(/索引|权限|无法连接/)
  })
})
