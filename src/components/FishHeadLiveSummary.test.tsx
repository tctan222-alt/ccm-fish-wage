import { cleanup,fireEvent,render,screen } from '@testing-library/react'
import { readFishHeadLivePriceDraft } from '../lib/fishHeadLivePriceDraft'
import { afterEach,expect,it } from 'vitest'
import { buildWeighingEntry,DEFAULT_FISH_SPECIES } from '../lib/weighing'
import { FishHeadLiveSummary } from './FishHeadLiveSummary'

afterEach(()=>{cleanup();window.localStorage.clear()})

it('keeps a settlement calculation limit from crashing the weighing page or showing a false total',()=>{
  const entries=Array.from({length:335},(_,index)=>buildWeighingEntry({
    id:`basket-${index}`,sessionId:'large-session',productType:'fish_head',fishSpeciesId:'jin_xian',fishSpecies:DEFAULT_FISH_SPECIES[0],
    fishMealQuality:null,entryMode:'individual',sequenceNo:index+1,weightGrams:300_000,remark:'',recordedAt:'2026-09-30T10:00:00+08:00',recordedBy:'test-user',
  }))
  render(<FishHeadLiveSummary entries={entries} vesselCode="978"/>)
  expect(screen.getByRole('alert')).toHaveTextContent('当前金额无法计算')
  expect(screen.getByRole('alert')).toHaveTextContent('仍可继续称重')
  expect(screen.queryByRole('group',{name:'现场金额总计'})).not.toBeInTheDocument()
})

it('refreshes the preview when loaded Master defaults change or become explicitly unpriced',()=>{
  const entries=[buildWeighingEntry({
    id:'basket-1',sessionId:'live-session',productType:'fish_head',fishSpeciesId:'jin_xian',fishSpecies:DEFAULT_FISH_SPECIES[0],
    fishMealQuality:null,entryMode:'individual',sequenceNo:1,weightGrams:10_000,remark:'',recordedAt:'2026-09-30T10:00:00+08:00',recordedBy:'test-user',
  })]
  const changed=DEFAULT_FISH_SPECIES.map(item=>item.speciesCode==='jin_xian'?{...item,basePriceCentsPerKg:250}:item)
  const unpriced=DEFAULT_FISH_SPECIES.map(item=>item.speciesCode==='jin_xian'?{...item,basePriceCentsPerKg:null}:item)
  const {rerender}=render(<FishHeadLiveSummary entries={entries} vesselCode="978" masterSpecies={DEFAULT_FISH_SPECIES}/>)
  expect(screen.getByRole('table',{name:'鱼头实时金额'})).toHaveTextContent('RM 2.10/kg')
  rerender(<FishHeadLiveSummary entries={entries} vesselCode="978" masterSpecies={changed}/>)
  expect(screen.getByRole('table',{name:'鱼头实时金额'})).toHaveTextContent('RM 2.55/kg')
  expect(screen.getByRole('group',{name:'现场金额总计'})).toHaveTextContent('当前总金额：RM 25.50')
  rerender(<FishHeadLiveSummary entries={entries} vesselCode="978" masterSpecies={unpriced}/>)
  expect(screen.getAllByText('未定价')).toHaveLength(2)
  expect(screen.getByRole('table',{name:'鱼头实时金额'})).not.toHaveTextContent('RM 0.00')
  expect(screen.getByRole('group',{name:'现场金额总计'})).toHaveTextContent('尚有 1 个鱼种未定价')
  expect(screen.getByRole('group',{name:'现场金额总计'})).not.toHaveTextContent('当前总金额')
  expect(entries[0]).not.toHaveProperty('unitPriceCentsPerKg')
})

it('edits the per-fish actual price and instant grand total, preserving it for a new settlement on this device',()=>{
  const entries=[buildWeighingEntry({
    id:'basket-1',sessionId:'session-1',productType:'fish_head',fishSpeciesId:'jin_xian',fishSpecies:DEFAULT_FISH_SPECIES[0],
    fishMealQuality:null,entryMode:'individual',sequenceNo:1,weightGrams:10_000,remark:'',
    recordedAt:'2026-09-30T10:00:00+08:00',recordedBy:'test-user',
  })]
  const props={entries,vesselCode:'978',masterSpecies:DEFAULT_FISH_SPECIES,ownerId:'user-1',sessionId:'session-1'}
  const {unmount}=render(<FishHeadLiveSummary {...props}/>)
  const input=screen.getByRole('textbox',{name:'金线现场单价（RM/kg）'})
  expect(input).toHaveValue('2.10')
  expect(screen.getByRole('group',{name:'现场金额总计'})).toHaveTextContent('RM 21.00')
  fireEvent.change(input,{target:{value:'3.25'}})
  expect(screen.getByRole('group',{name:'现场金额总计'})).toHaveTextContent('RM 32.50')
  expect(readFishHeadLivePriceDraft('user-1','session-1')).toEqual({'head:jin_xian':325})
  expect(readFishHeadLivePriceDraft('another-user','session-1')).toEqual({})
  expect(entries[0]).not.toHaveProperty('unitPriceCentsPerKg')
  unmount()
  render(<FishHeadLiveSummary {...props}/>)
  expect(screen.getByRole('textbox',{name:'金线现场单价（RM/kg）'})).toHaveValue('3.25')
  expect(screen.getByRole('group',{name:'现场金额总计'})).toHaveTextContent('RM 32.50')
  fireEvent.click(screen.getByRole('button',{name:'恢复建议价'}))
  expect(screen.getByRole('group',{name:'现场金额总计'})).toHaveTextContent('RM 21.00')
})

it('allows intentionally blank market prices, and invalid amounts never count as a valid total',()=>{
  const entries=[buildWeighingEntry({
    id:'basket-1',sessionId:'session-2',productType:'fish_head',fishSpeciesId:'jin_xian',fishSpecies:DEFAULT_FISH_SPECIES[0],
    fishMealQuality:null,entryMode:'individual',sequenceNo:1,weightGrams:10_000,remark:'',
    recordedAt:'2026-09-30T10:00:00+08:00',recordedBy:'test-user',
  })]
  render(<FishHeadLiveSummary entries={entries} vesselCode="833" masterSpecies={DEFAULT_FISH_SPECIES}
    sessionId="session-2" ownerId="user-1"/>)
  const input=screen.getByRole('textbox',{name:'金线现场单价（RM/kg）'})
  fireEvent.change(input,{target:{value:''}})
  expect(readFishHeadLivePriceDraft('user-1','session-2')).toEqual({'head:jin_xian':null})
  expect(screen.getByRole('group',{name:'现场金额总计'})).toHaveTextContent('尚有 1 个鱼种未定价')
  expect(screen.getByRole('group',{name:'现场金额总计'})).not.toHaveTextContent('当前总金额')
  fireEvent.change(input,{target:{value:'0'}})
  expect(screen.getByRole('alert')).toHaveTextContent('单价必须大于')
  expect(screen.getByRole('group',{name:'现场金额总计'})).toHaveTextContent('尚有 1 个鱼种未定价')
  expect(readFishHeadLivePriceDraft('user-1','session-2')).toEqual({'head:jin_xian':null})
  fireEvent.change(input,{target:{value:'2.60'}})
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(screen.getByRole('group',{name:'现场金额总计'})).toHaveTextContent('RM 26.00')
})
