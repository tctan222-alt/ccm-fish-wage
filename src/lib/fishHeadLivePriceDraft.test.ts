import { describe, expect, it } from 'vitest'
import { readFishHeadLivePriceDraft, saveFishHeadLivePriceDraft } from './fishHeadLivePriceDraft'

function memoryStorage(){
  const data=new Map<string,string>()
  return {
    getItem:(key:string)=>data.get(key)??null,
    setItem:(key:string,value:string)=>{data.set(key,value)},
    data,
  }
}

describe('fish-head local unit-price proposal safety',()=>{
  it('keeps only valid, explicit prices and nulls within one operator/session',()=>{
    const cache=memoryStorage(), prices={'head:jin_xian':210,'head:qing_lan':null}
    expect(saveFishHeadLivePriceDraft('user-a','session-1',prices,cache)).toBe(true)
    expect(readFishHeadLivePriceDraft('user-a','session-1',cache)).toEqual(prices)
    expect(readFishHeadLivePriceDraft('user-b','session-1',cache)).toEqual({})
    expect(readFishHeadLivePriceDraft('user-a','session-2',cache)).toEqual({})
  })
  it('rejects malformed prices rather than allowing invalid totals or zero',()=>{
    const cache=memoryStorage()
    expect(saveFishHeadLivePriceDraft('user','session',{'head:fish':0},cache)).toBe(false)
    expect(saveFishHeadLivePriceDraft('user','session',{'head:fish':-20},cache)).toBe(false)
    expect(saveFishHeadLivePriceDraft('user','session',{'head:fish':1.5},cache)).toBe(false)
    expect(saveFishHeadLivePriceDraft('user','session',{'head:fish':10_000_001},cache)).toBe(false)
    expect(saveFishHeadLivePriceDraft('user','session',{'meal:fish':200},cache)).toBe(false)
    expect(saveFishHeadLivePriceDraft('','session',{'head:fish':200},cache)).toBe(false)
    expect(cache.data.size).toBe(0)
  })
  it('rejects corrupt or old serialized drafts without borrowing another price',()=>{
    const cache=memoryStorage()
    const key=(()=>{saveFishHeadLivePriceDraft('a','s',{'head:fish':100},cache);return [...cache.data.keys()][0]})()
    cache.setItem(key,JSON.stringify({'head:fish':0}))
    expect(readFishHeadLivePriceDraft('a','s',cache)).toEqual({})
    cache.setItem(key,'invalid')
    expect(readFishHeadLivePriceDraft('a','s',cache)).toEqual({})
  })
  it('keeps UI live but reports when local persistence is unavailable',()=>{
    const noStorage={setItem:()=>{throw new Error('Private mode')}}
    expect(saveFishHeadLivePriceDraft('a','s',{'head:fish':250},noStorage)).toBe(false)
  })
})
