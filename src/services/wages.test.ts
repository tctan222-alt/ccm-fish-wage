import { describe, expect, it } from 'vitest'
import { prepareWageEntryForSave } from './wages'

describe('wage write preparation', () => {
  it('derives the complete business-date fields for a new write from the legacy date key', () => {
    expect(prepareWageEntryForSave({
      dateKey:'2026-02-28',workerId:'worker-1',workerName:'切鱼头工人',weightKg:80,
      rateRm:'0.12',wageRm:'9.60',createdBy:'u1',deleted:false,
    })).toMatchObject({
      businessDate:'28/02/2026',dateSortKey:20260228,monthKey:'02/2026',monthSortKey:202602,
    })
  })
})
