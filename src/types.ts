export type WorkerDepartment='fish_head_cutting'|'ccm_general'|'other'

export interface Worker {
  id:string
  name:string
  active:boolean
  order:number
  workerCode?:string
  phone?:string
  department?:string
  workerDepartment?:WorkerDepartment
  employmentStartDate?:string
  employmentEndDate?:string
  notes?:string
  createdBy?:string
  createdAt?:unknown
  updatedBy?:string
  updatedAt?:unknown
  inactiveBy?:string|null
  inactiveAt?:unknown|null
}
export interface WageEntry {
  dateKey:string
  businessDate?:string
  dateSortKey?:number
  monthKey?:string
  monthSortKey?:number
  workerId:string
  workerName:string
  weightKg:number
  rateRm:string
  wageRm:string
  createdBy:string|null
  deleted:boolean
}
