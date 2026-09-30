import { cleanup,render,screen } from '@testing-library/react'
import { afterEach,expect,it } from 'vitest'
import { buildWeighingEntry,DEFAULT_FISH_SPECIES } from '../lib/weighing'
import { FishHeadLiveSummary } from './FishHeadLiveSummary'

afterEach(cleanup)

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
