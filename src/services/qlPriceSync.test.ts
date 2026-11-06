import { describe, expect, it, vi } from 'vitest'
import seed from '../data/qlPrices20261010.json'
import { QL_SEED_VERSION, QL_SOURCE } from '../lib/qlPrices'
import { createAuthenticatedQlSheetReader, createQlPriceSync, QL_AUTH_UNAVAILABLE } from './qlPriceSync'

function future(date='2026-11-01') {
  const values:unknown[][]=seed.values.map(row=>[...row])
  values[1][1]=date
  values[3]=['大目力',3.15,0.1,3.25,'OK']
  return {source:{...QL_SOURCE,title:`QL Foods 鱼头价格表 ${date}`},version:`ql-foods-${date}`,effectiveDate:date,values}
}
function deferred<T>() {
  let resolve!:(value:T)=>void
  let reject!:(reason:unknown)=>void
  const promise=new Promise<T>((success,failure)=>{resolve=success;reject=failure})
  return {promise,resolve,reject}
}
const metadata=(title='QL Foods 鱼头价格表 2026-10-10')=>({spreadsheetId:QL_SOURCE.spreadsheetId,properties:{title},sheets:[{properties:{title:'Sheet1'}}]})
const response=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status})

describe('QL read-only reconciliation',()=>{
  it('reports the missing runtime authorization and retains the approved seed',async()=>{
    const sync=createQlPriceSync()
    const history=sync.getSnapshot().history
    await sync.check()
    expect(sync.getSnapshot()).toMatchObject({status:'error',error:QL_AUTH_UNAVAILABLE,history,preview:null,audit:[]})
    expect(sync.getSnapshot().history[0]).toBe(QL_SEED_VERSION)
    expect(sync.stagePreview()).toBe(false)
  })

  it('previews before/after without changing history, then explicitly stages once with local audit',async()=>{
    const source=future()
    const sync=createQlPriceSync({reader:async()=>source,clock:()=>new Date('2026-11-06T10:00:00.000Z')})
    const before=sync.getSnapshot().history
    await sync.check()
    expect(sync.getSnapshot().history).toBe(before)
    expect(sync.getSnapshot().preview?.diff.changes).toHaveLength(1)
    expect(sync.getSnapshot().preview?.diff.changes[0]).toMatchObject({kind:'changed',before:{priceCentsPerKg:315},after:{priceCentsPerKg:325}})
    expect(sync.getSnapshot().preview?.diff.warnings.join(' ')).toContain('丁温')
    expect(sync.stagePreview()).toBe(true)
    expect(sync.getSnapshot().history).toHaveLength(2)
    expect(sync.getSnapshot().history[0]).toBe(before[0])
    expect(before[0].rows[0].priceCentsPerKg).toBe(315)
    expect(sync.getSnapshot().audit).toHaveLength(1)
    expect(sync.getSnapshot().audit[0]).toMatchObject({action:'local-preview-staged',at:'2026-11-06T10:00:00.000Z',beforeVersion:QL_SEED_VERSION.version,afterVersion:source.version,effectiveDate:source.effectiveDate})
    expect(Object.isFrozen(sync.getSnapshot().audit[0].changes[0])).toBe(true)
    expect(sync.getSnapshot().preview).toBeNull()
    expect(sync.stagePreview()).toBe(false)
    await sync.check()
    expect(sync.getSnapshot().preview?.diff.changes).toEqual([])
    expect(sync.stagePreview()).toBe(false)
    expect(sync.getSnapshot().audit).toHaveLength(1)
  })

  it('treats unchanged seed reads as idempotent without an audit entry',async()=>{
    const sync=createQlPriceSync({reader:async()=>seed})
    const history=sync.getSnapshot().history
    await sync.check()
    expect(sync.getSnapshot().preview?.diff.changes).toEqual([])
    expect(sync.stagePreview()).toBe(false)
    expect(sync.getSnapshot().history).toBe(history)
    expect(sync.getSnapshot().audit).toEqual([])
  })

  it('rejects changed content at an existing date/version without replacing history',async()=>{
    const sync=createQlPriceSync({reader:async()=>future('2026-10-10')})
    const history=sync.getSnapshot().history
    await sync.check()
    expect(sync.getSnapshot().status).toBe('error')
    expect(sync.getSnapshot().error).toContain('不能覆盖历史')
    expect(sync.getSnapshot().history).toBe(history)
    expect(sync.getSnapshot().preview).toBeNull()
    expect(sync.getSnapshot().audit).toEqual([])
  })

  it('keeps a previous preview on reader failure but blocks staging stale data',async()=>{
    const reader=vi.fn().mockResolvedValueOnce(future()).mockRejectedValueOnce(new Error('来源暂时离线'))
    const sync=createQlPriceSync({reader})
    await sync.check()
    const previous=sync.getSnapshot().preview
    const history=sync.getSnapshot().history
    await sync.check()
    expect(sync.getSnapshot()).toMatchObject({status:'error',error:'来源暂时离线',preview:previous,history,audit:[]})
    expect(sync.stagePreview()).toBe(false)
  })

  it('rejects invalid rows atomically and preserves the prior complete preview',async()=>{
    const invalid=future('2026-12-01')
    invalid.values[4]=['大中目力',null,0.1,3.05,'OK']
    const reader=vi.fn().mockResolvedValueOnce(future()).mockResolvedValueOnce(invalid)
    const sync=createQlPriceSync({reader})
    await sync.check()
    const preview=sync.getSnapshot().preview
    await sync.check()
    expect(sync.getSnapshot().status).toBe('error')
    expect(sync.getSnapshot().preview).toBe(preview)
    expect(sync.getSnapshot().history).toEqual([QL_SEED_VERSION])
    expect(sync.stagePreview()).toBe(false)
  })

  it('ignores late success from an older check and aborts its signal',async()=>{
    const first=deferred<unknown>()
    const second=deferred<unknown>()
    const reader=vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const sync=createQlPriceSync({reader})
    const firstCheck=sync.check()
    const firstSignal=reader.mock.calls[0][0] as AbortSignal
    const secondCheck=sync.check()
    expect(firstSignal.aborted).toBe(true)
    second.resolve(future('2026-12-01'))
    await secondCheck
    const newest=sync.getSnapshot()
    first.resolve(future('2026-11-01'))
    await firstCheck
    expect(sync.getSnapshot()).toBe(newest)
    expect(sync.getSnapshot().preview?.candidate.effectiveDate).toBe('2026-12-01')
  })

  it('ignores late failure from an older check after a newer successful preview',async()=>{
    const first=deferred<unknown>()
    const reader=vi.fn().mockReturnValueOnce(first.promise).mockResolvedValueOnce(future())
    const sync=createQlPriceSync({reader})
    const firstCheck=sync.check()
    await sync.check()
    const newest=sync.getSnapshot()
    first.reject(new Error('old failure'))
    await firstCheck
    expect(sync.getSnapshot()).toBe(newest)
    expect(sync.getSnapshot().error).toBeNull()
  })

  it('cannot stage an old preview while its source is being rechecked',async()=>{
    const pending=deferred<unknown>()
    const reader=vi.fn().mockResolvedValueOnce(future()).mockReturnValueOnce(pending.promise)
    const sync=createQlPriceSync({reader})
    await sync.check()
    const check=sync.check()
    expect(sync.getSnapshot().status).toBe('checking')
    expect(sync.stagePreview()).toBe(false)
    expect(sync.getSnapshot().history).toEqual([QL_SEED_VERSION])
    pending.resolve(future('2026-12-01'))
    await check
    expect(sync.stagePreview()).toBe(true)
    expect(sync.getSnapshot().history[1].effectiveDate).toBe('2026-12-01')
  })

  it('cancels pending work on dispose and permits reuse after StrictMode cleanup',async()=>{
    const pending=deferred<unknown>()
    const reader=vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValueOnce(future())
    const sync=createQlPriceSync({reader})
    const check=sync.check()
    sync.dispose()
    const disposed=sync.getSnapshot()
    pending.resolve(future('2026-12-01'))
    await check
    expect(sync.getSnapshot()).toBe(disposed)
    expect(sync.getSnapshot().preview).toBeNull()
    await sync.check()
    expect(sync.getSnapshot().status).toBe('ready')
  })

  it('rolls back staging completely if the audit timestamp cannot be created',async()=>{
    const sync=createQlPriceSync({reader:async()=>future(),clock:()=>new Date('invalid')})
    await sync.check()
    const history=sync.getSnapshot().history
    expect(sync.stagePreview()).toBe(false)
    expect(sync.getSnapshot().status).toBe('error')
    expect(sync.getSnapshot().history).toBe(history)
    expect(sync.getSnapshot().audit).toEqual([])
  })

  it('notifies subscribers with stable snapshots and respects unsubscribe',async()=>{
    const sync=createQlPriceSync({reader:async()=>seed})
    expect(sync.getSnapshot()).toBe(sync.getSnapshot())
    const listener=vi.fn()
    const unsubscribe=sync.subscribe(listener)
    await sync.check()
    expect(listener).toHaveBeenCalledTimes(2)
    unsubscribe()
    await sync.check()
    expect(listener).toHaveBeenCalledTimes(2)
  })
})

describe('authenticated QL Sheet read adapter',()=>{
  it('uses only GET on the pinned workbook metadata and bounded range, then validates the envelope',async()=>{
    const fetch=vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(response(metadata()))
      .mockResolvedValueOnce(response({range:QL_SOURCE.range,majorDimension:'ROWS',values:seed.values}))
    const getAccessToken=vi.fn().mockResolvedValue('ephemeral-token')
    const reader=createAuthenticatedQlSheetReader({getAccessToken,fetch})
    const signal=new AbortController().signal
    const result=await reader(signal)
    expect(result).toEqual({...seed,source:{...seed.source,url:QL_SOURCE.url}})
    expect(fetch).toHaveBeenCalledTimes(2)
    const base=`https://sheets.googleapis.com/v4/spreadsheets/${QL_SOURCE.spreadsheetId}`
    expect(fetch.mock.calls[0][0]).toBe(`${base}?fields=spreadsheetId,properties(title),sheets(properties(title))`)
    expect(fetch.mock.calls[1][0]).toBe(`${base}/values/Sheet1!A1%3AE39?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING&majorDimension=ROWS`)
    for(const [,options] of fetch.mock.calls)expect(options).toEqual({method:'GET',headers:{Authorization:'Bearer ephemeral-token'},signal,credentials:'omit',redirect:'error',cache:'no-store'})
    expect(JSON.stringify(result)).not.toContain('ephemeral-token')
  })

  it('derives a future version only from an explicit title date consistent with the header',async()=>{
    const next=future()
    const fetch=vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(response(metadata(next.source.title)))
      .mockResolvedValueOnce(response({range:QL_SOURCE.range,majorDimension:'ROWS',values:next.values}))
    await expect(createAuthenticatedQlSheetReader({getAccessToken:async()=> 'token',fetch})()).resolves.toEqual(next)
  })

  it.each(['','throw'])('rejects unavailable authorization without sending a request (%s)',async mode=>{
    const fetch=vi.fn<typeof globalThis.fetch>()
    const reader=createAuthenticatedQlSheetReader({getAccessToken:async()=>{if(mode==='throw')throw new Error('private credential');return ''},fetch})
    await expect(reader()).rejects.toThrow('只读授权不可用')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('never echoes HTTP response bodies or underlying credential errors',async()=>{
    const fetch=vi.fn<typeof globalThis.fetch>().mockResolvedValue(response({secret:'should stay private'},403))
    await expect(createAuthenticatedQlSheetReader({getAccessToken:async()=> 'token',fetch})()).rejects.toThrow('无权读取指定原表')
    const failed=vi.fn<typeof globalThis.fetch>().mockRejectedValue(new Error('Bearer do-not-echo'))
    await expect(createAuthenticatedQlSheetReader({getAccessToken:async()=> 'token',fetch:failed})()).rejects.toThrow('无法读取 QL Google Sheet')
  })

  it.each([
    {...metadata(),spreadsheetId:'another-sheet'},
    {...metadata(),sheets:[{properties:{title:'Other'}}]},
    metadata('QL Foods no date'),
    null,
  ])('rejects metadata changes before attempting price reads #%#',async data=>{
    const fetch=vi.fn<typeof globalThis.fetch>().mockResolvedValue(response(data))
    await expect(createAuthenticatedQlSheetReader({getAccessToken:async()=> 'token',fetch})()).rejects.toThrow(/来源|生效日期/)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it.each([
    {range:'Other!A1:E39',majorDimension:'ROWS',values:seed.values},
    {range:QL_SOURCE.range,majorDimension:'COLUMNS',values:seed.values},
    {range:QL_SOURCE.range,majorDimension:'ROWS',values:null},
  ])('rejects an unexpected values response #%#',async data=>{
    const fetch=vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(response(metadata())).mockResolvedValueOnce(response(data))
    await expect(createAuthenticatedQlSheetReader({getAccessToken:async()=> 'token',fetch})()).rejects.toThrow('范围或返回格式')
  })

  it('rejects a title/header date mismatch instead of inferring another version',async()=>{
    const fetch=vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(response(metadata('QL Foods 鱼头价格表 2026-11-01')))
      .mockResolvedValueOnce(response({range:QL_SOURCE.range,majorDimension:'ROWS',values:seed.values}))
    await expect(createAuthenticatedQlSheetReader({getAccessToken:async()=> 'token',fetch})()).rejects.toThrow('生效日期')
  })
})
