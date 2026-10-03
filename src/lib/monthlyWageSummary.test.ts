import { expect, it } from 'vitest'
import { summarizeMonthlyWages } from './monthlyWageSummary'

it('cross-checks individual, daily and monthly wages in integer cents, independent of legacy payment/remark fields', () => {
  const rows = [
    { workerId: 'a', workerName: '阿明', dateKey: '2026-10-01', weightKg: 74, wageRm: '8.88', deleted: false, paid: true, remark: 'legacy' },
    { workerId: 'a', workerName: '阿明', dateKey: '2026-10-02', weightKg: 71, wageRm: '10.65', deleted: false },
    { workerId: 'b', workerName: '小妹', dateKey: '2026-10-02', weightKg: 80, wageRm: '14.40', deleted: false },
    { workerId: 'b', workerName: '小妹', dateKey: '2026-10-03', weightKg: 100, wageRm: '18.00', deleted: true },
  ]
  const result = summarizeMonthlyWages(rows)
  expect(result.workers).toEqual([
    { workerId: 'a', workerName: '阿明', workDays: 2, baskets: 2, weightKg: 145, wageCents: 1953 },
    { workerId: 'b', workerName: '小妹', workDays: 1, baskets: 1, weightKg: 80, wageCents: 1440 },
  ])
  expect(result.days).toEqual([
    { dateKey: '2026-10-01', workers: 1, baskets: 1, weightKg: 74, wageCents: 888 },
    { dateKey: '2026-10-02', workers: 2, baskets: 2, weightKg: 151, wageCents: 2505 },
  ])
  expect(result.monthWageCents).toBe(3393)
  expect(result.workers.reduce((sum, row) => sum + row.wageCents, 0)).toBe(3393)
  expect(result.days.reduce((sum, row) => sum + row.wageCents, 0)).toBe(3393)
})
