import { businessDateFromLegacy,sortKeyFromBusinessDate } from './businessDate'

export interface SettlementDateHeader {id:string;productType?:string;weighingDate:string;dateSortKey?:number}
export interface SettlementDateKeyFinding {id:string;productType:string;weighingDate:string;before:number|null;after:number|null;reason:'missing'|'inconsistent'|'invalid_date'}
/** Pure inspection of projected headers. This never reads or writes Firestore. */
export function auditSettlementDateKeys(headers:SettlementDateHeader[]){
  return headers.flatMap<SettlementDateKeyFinding>(header=>{
    if(header.productType!=='fish_head'&&header.productType!=='fish_meal')return []
    try{
      const expected=sortKeyFromBusinessDate(businessDateFromLegacy(header.weighingDate))
      return header.dateSortKey===expected?[]:[{id:header.id,productType:header.productType,weighingDate:header.weighingDate,
        before:header.dateSortKey??null,after:expected,reason:header.dateSortKey===undefined?'missing' as const:'inconsistent' as const}]
    }catch{return [{id:header.id,productType:header.productType,weighingDate:header.weighingDate,before:header.dateSortKey??null,after:null,reason:'invalid_date' as const}]}
  })
}
