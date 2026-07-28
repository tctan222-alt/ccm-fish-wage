export interface Worker { id:string; name:string; active:boolean; order:number }
export interface WageEntry { dateKey:string; workerId:string; workerName:string; weightKg:number; rateRm:string; wageRm:string; createdBy:string|null; deleted:false }
