import { fishHeadBasePrices } from '../features/purchases/pricing/defaultPurchasePrices'
import type { FishSpeciesRecord } from './weighing'

type MasterPrice = Pick<FishSpeciesRecord,'displayName'|'basePriceCentsPerKg'>
// Leave room for the existing +5-cent vessel premium within the settlement limit.
export const MAX_FISH_HEAD_BASE_PRICE_CENTS = 9_999_995

/** A missing field retains the existing price list; explicit null means no default. */
export function fishHeadMasterBasePriceCents(species:MasterPrice):number|null {
  const price=species.basePriceCentsPerKg===undefined
    ?fishHeadBasePrices[species.displayName.trim()]??null:species.basePriceCentsPerKg
  return price!==null&&Number.isSafeInteger(price)&&price>0&&price<=MAX_FISH_HEAD_BASE_PRICE_CENTS?price:null
}

/** Split the decimal string before conversion so stored money is always integer cents. */
export function fishHeadMasterPriceInputToCents(input:string):number|null {
  const clean=input.trim()
  if(!clean)return null
  if(!/^\d+(?:\.\d{1,2})?$/.test(clean))throw new Error('基础默认价须为正数，最多两位小数。')
  const [whole,fraction='']=clean.split('.')
  const cents=Number(whole)*100+Number(fraction.padEnd(2,'0'))
  if(!Number.isSafeInteger(cents)||cents<=0||cents>MAX_FISH_HEAD_BASE_PRICE_CENTS)
    throw new Error('基础默认价须大于 RM0，并且不超过 RM99,999.95/kg。')
  return cents
}

export function fishHeadMasterPriceInputValue(species:MasterPrice):string {
  const cents=fishHeadMasterBasePriceCents(species)
  return cents===null?'':`${Math.floor(cents/100)}.${String(cents%100).padStart(2,'0')}`
}
