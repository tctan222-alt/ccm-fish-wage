import { useRef,useState } from 'react'
import { buildFishHeadLiveValuation } from '../lib/fishHeadLiveValuation'
import { readFishHeadLivePriceDraft,saveFishHeadLivePriceDraft,type FishHeadLivePriceDraft } from '../lib/fishHeadLivePriceDraft'
import { formatSettlementMoney,parseSettlementPrice } from '../lib/purchaseSettlement'
import { MAX_PURCHASE_UNIT_PRICE_CENTS_PER_KG } from '../lib/purchasing'
import { formatWeightKg,type FishSpeciesRecord,type WeighingEntry } from '../lib/weighing'

const priceText=(cents:number|null)=>cents===null?'':(cents/100).toFixed(2)

export function FishHeadLiveSummary({
  entries,vesselCode,masterSpecies=[],sessionId='',ownerId='',readOnly=false,
}:{
  entries:WeighingEntry[];vesselCode:string;masterSpecies?:readonly FishSpeciesRecord[]
  sessionId?:string;ownerId?:string;readOnly?:boolean
}){
  const [overrides,setOverrides]=useState<FishHeadLivePriceDraft>(()=>readFishHeadLivePriceDraft(ownerId,sessionId))
  const overridesRef=useRef(overrides)
  const [priceInputs,setPriceInputs]=useState<Record<string,string>>(()=>Object.fromEntries(
    Object.entries(readFishHeadLivePriceDraft(ownerId,sessionId)).map(([key,price])=>[key,priceText(price)])))
  const [errors,setErrors]=useState<Record<string,string>>({})
  const [cacheError,setCacheError]=useState(false)
  const entryById=new Map(entries.map(entry=>[entry.id,entry]))
  const rowKey=(row:{nameSnapshot:string;sourceEntryIds:string[]})=>{
    const first=entryById.get(row.sourceEntryIds[0])
    return `head:${first?.fishSpeciesCodeSnapshot??first?.fishSpeciesId??row.nameSnapshot}`
  }

  function changePrice(key:string,text:string){
    if(readOnly)return
    setPriceInputs(current=>({...current,[key]:text}))
    let parsed:number|null
    try{
      parsed=parseSettlementPrice(text)
      if(parsed!==null&&(parsed<=0||parsed>MAX_PURCHASE_UNIT_PRICE_CENTS_PER_KG))
        throw new Error('单价必须大于 RM0，最多 RM100,000.00/kg。')
    }catch(problem){
      setErrors(current=>({...current,[key]:problem instanceof Error?problem.message:'单价格式不正确'}))
      return
    }
    setErrors(current=>{const next={...current};delete next[key];return next})
    const next={...overridesRef.current,[key]:parsed}
    overridesRef.current=next
    setOverrides(next)
    if(!saveFishHeadLivePriceDraft(ownerId,sessionId,next))setCacheError(true)
    else setCacheError(false)
  }

  function restoreDefault(key:string){
    const next={...overridesRef.current}
    delete next[key]
    overridesRef.current=next
    setOverrides(next)
    setPriceInputs(current=>{const copy={...current};delete copy[key];return copy})
    setErrors(current=>{const copy={...current};delete copy[key];return copy})
    setCacheError(!saveFishHeadLivePriceDraft(ownerId,sessionId,next))
  }

  const previewOverrides={...overrides}
  for(const key of Object.keys(errors))previewOverrides[key]=null
  let valuation
  try{valuation=buildFishHeadLiveValuation(entries,vesselCode,masterSpecies,previewOverrides)}
  catch{return <p className="error" role="alert">当前金额无法计算，请核对重量和单价；仍可继续称重。</p>}
  if(valuation.rows.length===0)return null

  return <div className="fish-head-live-valuation">
    <p className="valuation-caption">实时重量与金额（单价可修改，结单前可继续调整）</p>
    <table aria-label="鱼头实时金额">
      <thead><tr><th scope="col">鱼名</th><th scope="col">篮数</th><th scope="col">总 kg</th><th scope="col">单价 RM/kg</th><th scope="col">金额 RM</th></tr></thead>
      <tbody>{valuation.rows.map(row=>{
        const key=rowKey(row)
        const effective=row.unitPriceCentsPerKg===undefined?row.defaultUnitPriceCentsPerKg:row.unitPriceCentsPerKg
        const changed=Object.prototype.hasOwnProperty.call(overrides,key)
        return <tr key={key}>
          <th scope="row">{row.nameSnapshot}</th>
          <td data-label="篮数">{row.basketCount} 篮</td>
          <td data-label="总 kg">{formatWeightKg(row.totalWeightGrams)} kg</td>
          <td data-label="单价 RM/kg">
            <strong>{effective===null?'未定价':`${formatSettlementMoney(effective)}/kg`}</strong>
            {!readOnly&&<label className="live-price-editor">
              <span>修改单价 RM/kg</span>
              <input aria-label={`${row.nameSnapshot}现场单价（RM/kg）`} inputMode="decimal" type="text"
                value={priceInputs[key]??priceText(row.defaultUnitPriceCentsPerKg)}
                aria-invalid={Boolean(errors[key])}
                onChange={event=>changePrice(key,event.target.value)}/>
              {changed&&<button type="button" onClick={()=>restoreDefault(key)}>恢复建议价</button>}
            </label>}
            {errors[key]&&<small className="error" role="alert">{errors[key]}</small>}
            {changed&&<small>Master 建议价：{row.defaultUnitPriceCentsPerKg===null?'未设':formatSettlementMoney(row.defaultUnitPriceCentsPerKg)}</small>}
          </td>
          <td data-label="金额 RM">{row.amountCents===null?'未定价':formatSettlementMoney(row.amountCents)}</td>
        </tr>
      })}</tbody>
    </table>
    <div className="valuation-totals" role="group" aria-label="现场金额总计">
      <span>总篮数 <strong>{valuation.basketCount} 篮</strong></span>
      <span>总重量 <strong>{formatWeightKg(valuation.totalWeightGrams)} kg</strong></span>
      <p>{valuation.missingPriceSpeciesCount>0?'已知金额':'当前总金额'}：<strong>{formatSettlementMoney(valuation.knownAmountCents)}</strong></p>
      {valuation.missingPriceSpeciesCount>0&&<p className="valuation-missing">尚有 {valuation.missingPriceSpeciesCount} 个鱼种未定价，未计入总额。</p>}
    </div>
    <p className="valuation-caption">现场改价暂存在此设备，进入结单时会带入；正式金额以保存的结单为准。不会改写 Master 或已结单历史价格。</p>
    {cacheError&&<p className="error" role="alert">当前设备未能保存临时单价，离开前请到结单页重新确认价格。</p>}
  </div>
}
