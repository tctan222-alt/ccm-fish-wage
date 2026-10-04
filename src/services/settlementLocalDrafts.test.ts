import { afterEach,describe,expect,it } from 'vitest'
import { createSettlementLocalDraftStore,localDraftMatches,type SettlementLocalDraft } from './settlementLocalDrafts'

afterEach(()=>window.localStorage.clear())
const draft:SettlementLocalDraft={version:1,productType:'fish_head',sourceSessionId:'source-A',sourceSessionRevision:3,settlementRevision:4,
  businessDate:'03/08/2026',vesselId:'v978',vesselCodeSnapshot:'978',receiptNo:'paper 123',priceInputs:{entry:'1.23'},lines:[],updatedAt:'2026-10-04T01:00:00Z'}
describe('stable local settlement draft recovery',()=>{
  it('persists prices and paper number through a fresh store, isolated by user/product/source',()=>{
    createSettlementLocalDraftStore('owner').save(draft)
    expect(createSettlementLocalDraftStore('owner').load('fish_head','source-A')).toEqual(draft)
    expect(createSettlementLocalDraftStore('owner').load('fish_meal','source-A')).toBeNull()
    expect(createSettlementLocalDraftStore('other-user').load('fish_head','source-A')).toBeNull()
    expect(createSettlementLocalDraftStore('owner').load('fish_head','source-B')).toBeNull()
  })
  it('never changes a draft on read or identity/revision mismatch; explicit discard removes it',()=>{
    const store=createSettlementLocalDraftStore('owner');store.save(draft)
    expect(localDraftMatches(draft,{...draft,sourceSessionRevision:5})).toBe(false)
    expect(localDraftMatches(draft,{...draft,settlementRevision:5})).toBe(false)
    expect(localDraftMatches(draft,{...draft,vesselId:'another'})).toBe(false)
    expect(localDraftMatches(draft,draft)).toBe(true)
    expect(store.load('fish_head','source-A')).toEqual(draft)
    store.remove('fish_head','source-A')
    expect(store.load('fish_head','source-A')).toBeNull()
  })
  it('reports unavailable/corrupt storage instead of silently claiming recovery',()=>{
    const broken={getItem:()=>'{broken',setItem:()=>{throw new Error('quota')},removeItem:()=>{throw new Error('denied')}}
    const store=createSettlementLocalDraftStore('owner',broken)
    expect(()=>store.load('fish_head','source-A')).toThrow('本机草稿')
    expect(()=>store.save(draft)).toThrow('本机草稿')
    expect(()=>store.remove('fish_head','source-A')).toThrow('本机草稿')
  })
})
