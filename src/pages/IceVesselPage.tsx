import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useParams } from 'react-router-dom'
import type { Vessel } from '../lib/purchasing'
import { createIceWorkRecord, summarizeIceMonthEndFees, type IceWorkRecord } from '../lib/iceWork'
import { loadVessels } from '../services/purchaseMasterData'
import { loadIceWorkRecords, saveIceWorkRecord, voidIceWorkRecord } from '../services/iceWork'

const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
const makeId=()=>`ice_${globalThis.crypto?.randomUUID?.().replaceAll('-','')??Date.now().toString(36)}`
const number=(value:string)=>value.trim()===''?0:Number(value)

interface Props { vesselLoader?:()=>Promise<Vessel[]>; recordLoader?:(vesselId:string,monthKey:string)=>Promise<IceWorkRecord[]>; saver?:(record:IceWorkRecord)=>Promise<IceWorkRecord>; voider?:(record:IceWorkRecord,reason:string)=>Promise<IceWorkRecord>; today?:()=>string }

export function IceVesselPage({vesselLoader=loadVessels,recordLoader=loadIceWorkRecords,saver=saveIceWorkRecord,voider=voidIceWorkRecord,today:todayValue=today}:Props) {
  const { vesselId = '' }=useParams()
  const [vessels,setVessels]=useState<Vessel[]>([]),[records,setRecords]=useState<IceWorkRecord[]>([]),[workDate,setWorkDate]=useState(todayValue()),[notes,setNotes]=useState(''),[factory,setFactory]=useState(''),[iceBoxes,setIceBoxes]=useState(''),[hawker,setHawker]=useState(''),[oil,setOil]=useState(''),[monthEnd,setMonthEnd]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('')
  const vessel=useMemo(()=>vessels.find(item=>item.id===vesselId||item.vesselCode===vesselId),[vessels,vesselId])
  const monthKey=workDate.slice(0,7)
  useEffect(()=>{void vesselLoader().then(rows=>setVessels(rows.filter(item=>item.active))).catch(()=>setError('无法载入船号。'))},[vesselLoader])
  useEffect(()=>{if(vessel)void recordLoader(vessel.id,monthKey).then(setRecords).catch(()=>setError('无法载入冰工月度记录。'))},[vessel,monthKey,recordLoader])
  const fees=summarizeIceMonthEndFees(records)
  async function submit(event:FormEvent){event.preventDefault();if(!vessel)return
    const quantities=[factory,iceBoxes,hawker,oil].map(number)
    if(quantities.some(value=>!Number.isFinite(value)||value<0)){setError('数量必须是 0 或正数。');return}
    setBusy(true);setError('')
    try{
      const saved=await saver(createIceWorkRecord({id:makeId(),workDate,vesselId:vessel.id,vesselCodeSnapshot:vessel.vesselCode,createdBy:'',factoryWoodTubQuantity:quantities[0],iceBoxQuantity:quantities[1],hawkerSaleQuantity:quantities[2],oilWorkQuantity:quantities[3],notes,monthEndSettlement:monthEnd}))
      setRecords(current=>[saved,...current]);setFactory('');setIceBoxes('');setHawker('');setOil('');setNotes('');setMonthEnd(false);window.dispatchEvent(new Event('ccm:form-saved'))
    }catch(problem){setError(problem instanceof Error?problem.message:'无法保存冰工记录。')}finally{setBusy(false)}
  }
  async function voidRecord(record:IceWorkRecord){const reason=window.prompt('作废原因')?.trim();if(!reason)return;try{const next=await voider(record,reason);setRecords(current=>current.map(item=>item.id===next.id?next:item))}catch(problem){setError(problem instanceof Error?problem.message:'无法作废记录。')}}
  return <main><header><p className="eyebrow">CCM Fishery</p><h1>冰工船 {vessel?.vesselCode??vesselId}</h1></header>
    {!vessel?<p className="notice">未找到 Active Vessels 中的此船号；请先在船号资料维护。</p>:<>
      <form className="master-form ice-work-form" onSubmit={submit}><h2>新增记录</h2><label>日期<input aria-label="日期" type="date" value={workDate} onChange={event=>setWorkDate(event.target.value)}/></label>
        <label>工厂木桶数量<input aria-label="工厂木桶数量" inputMode="decimal" value={factory} onChange={event=>setFactory(event.target.value)}/></label>
        <label>冰箱数量<input aria-label="冰箱数量" inputMode="decimal" value={iceBoxes} onChange={event=>setIceBoxes(event.target.value)}/></label>
        <label>小贩出售数量<input aria-label="小贩出售数量" inputMode="decimal" value={hawker} onChange={event=>setHawker(event.target.value)}/></label>
        <label>油工数量<input aria-label="油工数量" inputMode="decimal" value={oil} onChange={event=>setOil(event.target.value)}/></label>
        <p className="notice">0.02 的币值和计量单位尚待确认，系统不会自动计算油工金额。</p>
        <label><input aria-label="本月尾结算计入一次" type="checkbox" checked={monthEnd} disabled={fees.recordId!==null} onChange={event=>setMonthEnd(event.target.checked)}/>本月尾结算计入一次（船头费默认 RM 500、书记费默认 RM 250）</label>
        {fees.recordId!==null&&<p className="notice">本月已有月尾结算记录，船头费和书记费不会重复计入。</p>}
        <label>备注<textarea value={notes} maxLength={500} onChange={event=>setNotes(event.target.value)}/></label>{error&&<p className="error" role="alert">{error}</p>}<button className="primary-action" disabled={busy}>保存记录</button>
      </form>
      <section className="master-card-list"><h2>{monthKey} 月度记录</h2><p>月尾已计入：船头费 RM {(fees.headmanFeeCents/100).toFixed(2)}；书记费 RM {(fees.clerkFeeCents/100).toFixed(2)}</p>
        {records.map(record=><article className="master-card" key={record.id}><strong>{record.workDate}</strong><span>{record.voided?'已作废':'已记录'}</span><p>工厂木桶：{record.factoryWoodTubQuantity} · 冰箱：{record.iceBoxQuantity} · 小贩出售：{record.hawkerSaleQuantity} · 油工：{record.oilWorkQuantity}</p>{record.notes&&<p>{record.notes}</p>}{!record.voided&&<button type="button" className="danger-action" onClick={()=>void voidRecord(record)}>作废</button>}</article>)}
      </section>
    </>}
  </main>
}
