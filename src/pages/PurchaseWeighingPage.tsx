import type { WeighingProductType } from '../lib/weighing'
import { WeighingEntryPage } from './WeighingEntryPage'

export function PurchaseWeighingPage({ productType }:{ productType:WeighingProductType }) {
  const fishHead=productType==='fish_head'
  return <WeighingEntryPage fixedProductType={productType} requireUnitPrice pageTitle={fishHead?'鱼头购入':'鱼仔购入'} />
}
