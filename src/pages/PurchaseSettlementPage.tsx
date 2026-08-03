import { useEffect,useMemo,useState } from 'react'
import { Link,useParams } from 'react-router-dom'
import { legacyIsoDateFromBusinessDate,malaysiaBusinessDate,monthKeyFromBusinessDate,monthSortKeyFromMonthKey,sortKeyFromBusinessDate } from '../lib/businessDate'
import { buildPurchaseSettlementLines,formatSettlementMoney,makeSettlementDraft,updateSettlementLinePrice,totalSettlementAmountCents,type PurchaseSettlementDraft,type PurchaseSettlementLine,asSettlementSourceEntry } from '../lib/purchaseSettlement'
import { formatWeightKg,type WeighingEntry,type WeighingProductType,type WeighingSession } from '../lib/weighing'
import { activeVessels,type Vessel } from '../lib/purchasing'
import { loadVessels } from '../services/purchaseMasterData'
import { loadPurchaseSettlementDraft,loadPurchaseSettlementSource,savePurchaseSettlementDraft,type PurchaseSettlementSource } from '../services/purchaseSettlements'
import { loadWeighingBundle } from '../services/weighing'

function lineKey(line:PurchaseSettlementLine){return line.sourceEntryIds.join('|')}
function priceText(value:number|null){return value===null?'':(value/100).toFixed(2)}
function dateInputValue(value:string){try{return legacyIsoDateFromBusinessDate(value)}catch{return ''}}

export function PurchaseSettlementPage({
  productType,
  vesselLoader=loadVessels,
  sourceLoader=loadPurchaseSettlementSource,
  draftLoader=loadPurchaseSettlementDraft,
  draftSaver=savePurchaseSettlementDraft,
  bundleLoader=loadWeighingBundle,
  today=malaysiaBusinessDate,
}: {
  productType:WeighingProductType
  vesselLoader?:()=>Promise<Vessel[]>
  sourceLoader?:(vesselId:string,businessDate:string,productType:WeighingProductType)=>Promise<PurchaseSettlementSource>
  draftLoader?:(productType:WeighingProductType,dateSortKey:number,vesselId:string)=>Promise<PurchaseSettlementDraft|null>
  draftSaver?:(draft:PurchaseSettlementDraft)=>Promise<PurchaseSettlementDraft>
  bundleLoader?:(sessionId:string)=>Promise<{session:WeighingSession;entries:WeighingEntry[]}>
  today?:()=>string
}){
  const {sessionId}=useParams()
  const fishHead=productType==='fish_head'
  const [vessels,setVessels]=useState<Vessel[]>([]),[vesselId,setVesselId]=useState(''),[businessDate,setBusinessDate]=useState(today())
  const [entries,setEntries]=useState<WeighingEntry[]>([]),[lines,setLines]=useState<PurchaseSettlementLine[]>([])
  const [receiptNo,setReceiptNo]=useState(''),[priceInputs,setPriceInputs]=useState<Record<string,string>>({}),[error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false)
  const [loading,setLoading]=useState(true)

  useEffect(()=>{let cancelled=false;void vesselLoader().then(items=>{if(cancelled)return;const active=activeVessels(items);setVessels(active);setVesselId(current=>current||active[0]?.id||'')}).catch(()=>setError('无法载入船号资料。')).finally(()=>{if(!cancelled)setLoading(false)});return()=>{cancelled=true}},[vesselLoader])

  useEffect(()=>{
    if(!sessionId)return
    let cancelled=false
    setLoading(true);setError('')
    void bundleLoader(sessionId).then(async source=>{
      if(cancelled)return
      setVesselId(source.session.vesselId);setBusinessDate(source.session.weighingDate);setEntries(source.entries);setReceiptNo(source.session.externalSlipNo)
      const built=buildPurchaseSettlementLines(source.entries.map(asSettlementSourceEntry),productType,source.session.vesselCodeSnapshot)
      const draft=await draftLoader(productType,sortKeyFromBusinessDate(source.session.weighingDate),source.session.vesselId)
      const sourceIds=source.entries.filter(item=>!item.voided&&item.productType===productType).map(item=>item.id).sort()
      const useDraft=Boolean(draft&&draft.businessDate===source.session.weighingDate&&draft.sourceEntryIds.slice().sort().join('|')===sourceIds.join('|'))
      const nextLines=useDraft?draft!.lines:built
      setLines(nextLines);setPriceInputs(Object.fromEntries(nextLines.map(line=>[lineKey(line),priceText(line.unitPriceCentsPerKg)])))
      if(useDraft)setReceiptNo(draft!.receiptNo)
    }).catch(()=>{if(!cancelled)setError('无法载入结单资料。')}).finally(()=>{if(!cancelled)setLoading(false)})
    return()=>{cancelled=true}
  },[sessionId,bundleLoader,draftLoader,productType])

  useEffect(()=>{
    if(!vesselId||sessionId)return
    let cancelled=false
    setLoading(true);setError('');setMessage('')
    void sourceLoader(vesselId,businessDate,productType).then(async source=>{
      if(cancelled)return
      const sourceEntries=source.bundle?.entries??[]
      setEntries(sourceEntries);setReceiptNo(source.session?.externalSlipNo??'')
      const built=buildPurchaseSettlementLines(sourceEntries.map(asSettlementSourceEntry),productType,source.session?.vesselCodeSnapshot??(vessels.find(item=>item.id===vesselId)?.vesselCode??''))
      const draft=await draftLoader(productType,sortKeyFromBusinessDate(businessDate),vesselId)
      const sourceIds=sourceEntries.filter(item=>!item.voided&&item.productType===productType).map(item=>item.id).sort()
      const draftIds=draft?.sourceEntryIds.slice().sort()??[]
      const useDraft=Boolean(draft&&draft.businessDate===businessDate&&draftIds.join('|')===sourceIds.join('|'))
      const nextLines=useDraft?draft!.lines:built
      setLines(nextLines);setPriceInputs(Object.fromEntries(nextLines.map(line=>[lineKey(line),priceText(line.unitPriceCentsPerKg)])))
      if(useDraft)setReceiptNo(draft!.receiptNo)
    }).catch(()=>{if(!cancelled)setError('无法载入结单资料。')}).finally(()=>{if(!cancelled)setLoading(false)})
    return()=>{cancelled=true}
  },[vesselId,businessDate,productType,sourceLoader,draftLoader,sessionId,vessels])

  const selectedVessel=vessels.find(item=>item.id===vesselId)
  const total=useMemo(()=>totalSettlementAmountCents(lines),[lines])
  const sourceEntryCount=entries.filter(item=>!item.voided&&item.productType===productType).length
  function changePrice(line:PurchaseSettlementLine,value:string){
    const key=lineKey(line);setPriceInputs(current=>({...current,[key]:value}));
    try{setLines(current=>current.map(item=>lineKey(item)===key?updateSettlementLinePrice(item,value):item));setError('')}
    catch(problem){setError(problem instanceof Error?problem.message:'单价格式不正确。')}
  }
  async function saveDraft(){
    if(!selectedVessel||lines.length===0){setError('当前没有可保存的结单记录。');return}
    try{
      setBusy(true);setError('')
      const monthKey=monthKeyFromBusinessDate(businessDate)
      const saved=await draftSaver(makeSettlementDraft({productType,businessDate,dateSortKey:sortKeyFromBusinessDate(businessDate),monthKey,monthSortKey:monthSortKeyFromMonthKey(monthKey),
        vesselId:selectedVessel.id,vesselCodeSnapshot:selectedVessel.vesselCode,receiptNo:receiptNo.trim(),lines,sourceEntryIds:entries.filter(item=>!item.voided&&item.productType===productType).map(item=>item.id),createdBy:'',revision:1}))
      setMessage(`结单草稿已保存（第 ${saved.revision} 版）。`)
    }catch(problem){setError(problem instanceof Error?problem.message:'无法保存结单草稿。')}finally{setBusy(false)}
  }
  async function copyTable(){
    const header=fishHead?'鱼名\t总重量\t篮数\t预设价\t单价 RM/kg\t金额':'品质\t总重量\t篮数/总重记录\t预设价\t单价 RM/kg\t金额'
    const rows=lines.map(line=>[line.nameSnapshot,`${formatWeightKg(line.totalWeightGrams)} kg`,fishHead?`${line.basketCount}篮`:`${line.basketCount}篮 / 总重${line.totalWeightEntryCount-line.basketCount}条`,priceText(line.defaultUnitPriceCentsPerKg)||'-',priceText(line.unitPriceCentsPerKg),formatSettlementMoney(line.amountCents)].join('\t'))
    try{await navigator.clipboard?.writeText([header,...rows,`总额\t${formatSettlementMoney(total)}`].join('\n'));setMessage('表格已复制，可以贴到 Excel。')}catch{setError('无法复制表格，请手动选择复制。')}
  }
  return <main className="purchase-settlement-page"><header><p className="eyebrow">CCM Fishery</p><h1>{fishHead?'鱼头结单':'鱼仔结单'}</h1><Link className="page-link" to={fishHead?'/fish-head-purchase':'/fish-meal-purchase'}>← 返回现场录入</Link></header>
    <section className="settlement-context"><label>船号<select aria-label="船号" value={vesselId} disabled={Boolean(sessionId)} onChange={event=>setVesselId(event.target.value)}>{vessels.map(item=><option value={item.id} key={item.id}>{item.vesselCode}</option>)}</select></label>
      <label>日期<input aria-label="日期" type="date" value={dateInputValue(businessDate)} disabled={Boolean(sessionId)} onChange={event=>{if(event.target.value)setBusinessDate(event.target.value.split('-').reverse().join('/'))}}/><small>{businessDate}</small></label>
      <label className="settlement-receipt-no">单号（可之后补填）<input aria-label="单号" value={receiptNo} onChange={event=>setReceiptNo(event.target.value)} placeholder="可留空"/></label></section>
    {error&&<p className="error" role="alert">{error}</p>}{message&&<p className="notice" role="status">{message}</p>}
    {loading?<p className="notice">正在载入结单资料…</p>:<section className="settlement-table-section"><p className="settlement-meta">船号：{selectedVessel?.vesselCode??'—'} / 日期：{businessDate} / 当前记录：{sourceEntryCount} 条</p>
      {lines.length===0?<p className="notice">当前船号和日期没有可结单的{fishHead?'鱼头':'鱼仔'}记录。</p>:<><div className="settlement-table-scroll"><table className="settlement-table"><caption>{fishHead?'鱼头结单检查表':'鱼仔结单检查表'}</caption><thead><tr><th>{fishHead?'鱼名':'品质'}</th><th>总重量</th><th>{fishHead?'篮数':'篮数/总重记录'}</th><th>预设价</th><th>单价 RM/kg</th><th>金额</th></tr></thead><tbody>{lines.map(line=><tr key={lineKey(line)}><th scope="row">{line.nameSnapshot}</th><td>{formatWeightKg(line.totalWeightGrams)} kg</td><td>{fishHead?`${line.basketCount}篮`:`${line.basketCount}篮 / 总重${line.totalWeightEntryCount-line.basketCount}条`}</td><td>{priceText(line.defaultUnitPriceCentsPerKg)?`RM ${priceText(line.defaultUnitPriceCentsPerKg)}`:'-'}</td><td><input aria-label={`${line.nameSnapshot}单价`} type="text" inputMode="decimal" value={priceInputs[lineKey(line)]??''} onChange={event=>changePrice(line,event.target.value)}/></td><td>{formatSettlementMoney(line.amountCents)}</td></tr>)}</tbody><tfoot><tr><th colSpan={5}>总额</th><td>{formatSettlementMoney(total)}</td></tr></tfoot></table></div><div className="settlement-actions"><button type="button" onClick={()=>void copyTable()}>复制表格</button><button className="primary-action" type="button" disabled={busy} onClick={()=>void saveDraft()}>保存结单草稿</button></div></>}
    </section>}
  </main>
}
