import { rmStringToCents } from './wage'

type WageRow = { workerId: string; workerName: string; dateKey: string; weightKg: number; wageRm: string; deleted: boolean }
export function summarizeMonthlyWages(entries: readonly WageRow[]) {
  const workers = new Map<string, { workerId: string; workerName: string; dates: Set<string>; baskets: number; weightKg: number; wageCents: number }>()
  const days = new Map<string, { dateKey: string; workerIds: Set<string>; baskets: number; weightKg: number; wageCents: number }>()
  let monthWageCents = 0
  for (const row of entries.filter(entry => entry.deleted !== true)) {
    const id = row.workerId || row.workerName, cents = rmStringToCents(row.wageRm)
    const worker = workers.get(id) ?? { workerId: row.workerId, workerName: row.workerName, dates: new Set<string>(), baskets: 0, weightKg: 0, wageCents: 0 }
    const day = days.get(row.dateKey) ?? { dateKey: row.dateKey, workerIds: new Set<string>(), baskets: 0, weightKg: 0, wageCents: 0 }
    worker.dates.add(row.dateKey); worker.baskets++; worker.weightKg += row.weightKg; worker.wageCents += cents
    day.workerIds.add(id); day.baskets++; day.weightKg += row.weightKg; day.wageCents += cents
    workers.set(id, worker); days.set(row.dateKey, day); monthWageCents += cents
  }
  return {
    workers: [...workers.values()].map(({ dates, ...worker }) => ({ ...worker, workDays: dates.size })),
    days: [...days.values()].sort((a, b) => a.dateKey.localeCompare(b.dateKey)).map(({ workerIds, ...day }) => ({ ...day, workers: workerIds.size })),
    monthWageCents,
  }
}
