import { buildFishHeadLiveValuation } from '../lib/fishHeadLiveValuation'
import { formatSettlementMoney } from '../lib/purchaseSettlement'
import { formatWeightKg,type WeighingEntry } from '../lib/weighing'

export function FishHeadLiveSummary({entries,vesselCode}:{entries:WeighingEntry[];vesselCode:string}){
  let valuation
  try{valuation=buildFishHeadLiveValuation(entries,vesselCode)}
  catch{return <p className="error" role="alert">当前金额无法计算，请核对称重资料；仍可继续称重。</p>}
  if(valuation.rows.length===0)return null

  return <div className="fish-head-live-valuation">
    <p className="valuation-caption">当前默认价预览</p>
    <table aria-label="鱼头实时金额">
      <thead><tr><th scope="col">鱼名</th><th scope="col">篮数</th><th scope="col">总 kg</th><th scope="col">单价 RM/kg</th><th scope="col">金额 RM</th></tr></thead>
      <tbody>{valuation.rows.map(row=><tr key={row.sourceEntryIds[0]}>
        <th scope="row">{row.nameSnapshot}</th>
        <td data-label="篮数">{row.basketCount} 篮</td>
        <td data-label="总 kg">{formatWeightKg(row.totalWeightGrams)} kg</td>
        <td data-label="单价 RM/kg">{row.defaultUnitPriceCentsPerKg===null?'—':`${formatSettlementMoney(row.defaultUnitPriceCentsPerKg)}/kg`}</td>
        <td data-label="金额 RM">{row.amountCents===null?'—':formatSettlementMoney(row.amountCents)}</td>
      </tr>)}</tbody>
    </table>
    <div className="valuation-totals" role="group" aria-label="现场金额总计">
      <span>总篮数 <strong>{valuation.basketCount} 篮</strong></span>
      <span>总重量 <strong>{formatWeightKg(valuation.totalWeightGrams)} kg</strong></span>
      <p>{valuation.missingPriceSpeciesCount>0?'已知金额':'当前总金额'}：<strong>{formatSettlementMoney(valuation.knownAmountCents)}</strong></p>
      {valuation.missingPriceSpeciesCount>0&&<p className="valuation-missing">尚有 {valuation.missingPriceSpeciesCount} 个鱼种未定价</p>}
    </div>
  </div>
}
