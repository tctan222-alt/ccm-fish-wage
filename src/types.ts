export interface Worker {
  id:string
  name:string
  active:boolean
  order:number
  workerCode?:string
  phone?:string
  department?:string
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
export interface WageEntry { dateKey:string; workerId:string; workerName:string; weightKg:number; rateRm:string; wageRm:string; createdBy:string|null; deleted:boolean }
