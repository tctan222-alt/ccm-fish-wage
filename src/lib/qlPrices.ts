import groupCatalogue from '../data/qlPriceGroups.json'
import seedSheet from '../data/qlPrices20261010.json'

export const QL_SOURCE = Object.freeze({
  spreadsheetId:'1pFm8RuNceQZE4sHdRGS5XEMhqgzMSN7bEriHrIYySxo',
  range:'Sheet1!A1:E39',
  url:'https://docs.google.com/spreadsheets/d/1pFm8RuNceQZE4sHdRGS5XEMhqgzMSN7bEriHrIYySxo/edit',
})
export type QlMethod = 'general'|'trawl'|'bottom'
export const QL_METHOD_LABELS:Record<QlMethod,string> = {general:'一般组别',trawl:'拖网',bottom:'底船'}
export type QlPriceRow = Readonly<{
  groupKey:string
  sourceRow:number
  label:string
  aliases:readonly string[]
  method:QlMethod
  oldPriceCentsPerKg:number
  changeCentsPerKg:number
  priceCentsPerKg:number
}>
export type QlPriceVersion = Readonly<{
  version:string
  effectiveDate:string
  source:Readonly<typeof QL_SOURCE & {title:string}>
  rows:readonly QlPriceRow[]
}>
export type QlPriceChange = Readonly<{
  key:string
  kind:'added'|'removed'|'changed'
  before:QlPriceRow|null
  after:QlPriceRow|null
}>
export type QlPriceDiff = {changes:QlPriceChange[],warnings:string[]}

type Group = {groupKey:string,label:string,aliases:string[],method:QlMethod}
const groups = groupCatalogue as Group[]
const groupByLabel = new Map(groups.map(group=>[group.label,group]))
const isRecord = (value:unknown):value is Record<string,unknown> => !!value&&typeof value==='object'&&!Array.isArray(value)

function requireDate(value:unknown):string {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))throw new Error('QL 生效日期须为 YYYY-MM-DD。')
  const date = new Date(`${value}T00:00:00.000Z`)
  if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==value)throw new Error('QL 生效日期无效。')
  return value
}

/** Parse decimal text before arithmetic; never round source errors into accepted prices. */
export function qlMoneyToCents(value:unknown,allowZero=false):number {
  if(typeof value!=='string'&&typeof value!=='number')throw new Error('QL 价格不能为空。')
  const clean=String(value).trim().replace(/^\+?\s*RM\s*/,'').replace(/^\+/,'')
  if(allowZero&&(clean==='—'||clean==='-'))return 0
  if(!/^\d+(?:\.\d{1,2})?$/.test(clean))throw new Error('QL 价格须为最多两位小数的 RM 金额。')
  const [whole,fraction='']=clean.split('.')
  const cents=Number(whole)*100+Number(fraction.padEnd(2,'0'))
  if(!Number.isSafeInteger(cents)||cents<(allowZero?0:1)||cents>10_000_000)throw new Error('QL 价格超出有效范围。')
  return cents
}

export function qlAdjustmentToCents(value:unknown):number {
  if(typeof value!=='string'&&typeof value!=='number')throw new Error('QL 调整金额不能为空。')
  const clean=String(value).trim()
  if(clean==='—'||clean==='-')return 0
  const parts=/^([+-]?)\s*(?:RM\s*)?(\d+(?:\.\d{1,2})?)$/.exec(clean)
    ??/^RM\s*([+-]?)\s*(\d+(?:\.\d{1,2})?)$/.exec(clean)
  if(!parts)throw new Error('QL 调整须为最多两位小数的 RM 金额。')
  const cents=qlMoneyToCents(parts[2],true)
  return parts[1]==='-'&&cents>0?-cents:cents
}

/** One read-only ingestion boundary shared by the bundled snapshot and future authenticated reads. */
export function validateQlSheet(input:unknown):QlPriceVersion {
  if(!isRecord(input)||!isRecord(input.source))throw new Error('QL 来源格式无效。')
  if(input.source.spreadsheetId!==QL_SOURCE.spreadsheetId||input.source.range!==QL_SOURCE.range)
    throw new Error('QL 来源必须是已批准的 Google Sheet 与范围。')
  const effectiveDate=requireDate(input.effectiveDate)
  const title=`QL Foods 鱼头价格表 ${effectiveDate}`
  if(input.source.title!==title)throw new Error('QL 表格标题与生效日期不一致，须复核。')
  if(typeof input.version!=='string'||!/^ql-foods-\d{4}-\d{2}-\d{2}(?:-[a-zA-Z0-9_-]+)?$/.test(input.version)
    ||!input.version.startsWith(`ql-foods-${effectiveDate}`))throw new Error('QL 版本须包含对应生效日期。')
  if(!Array.isArray(input.values)||input.values.length!==39)throw new Error('QL 来源须完整包含 Sheet1!A1:E39。')
  const [heading,dateRow,columns]=input.values
  if(!Array.isArray(heading)||heading[0]!=='QL Foods Sdn. Bhd. 鱼头价格表'
    ||!Array.isArray(dateRow)||dateRow[0]!=='生效日期'||dateRow[1]!==effectiveDate
    ||JSON.stringify(columns)!==JSON.stringify(['鱼名','旧价格','调整 RM/KG','新价格','复核']))
    throw new Error('QL 来源表头或生效日期已改变，须复核。')
  const seen=new Set<string>()
  const rows=input.values.slice(3).map((cells:unknown,index:number):QlPriceRow=>{
    const sourceRow=index+4
    if(!Array.isArray(cells)||cells.length!==5||typeof cells[0]!=='string')
      throw new Error(`QL 第 ${sourceRow} 行缺少必要数据。`)
    const label=cells[0]
    const group=groupByLabel.get(label)
    if(!group)throw new Error(`QL 第 ${sourceRow} 行组别或作业方式改变，须人工复核：${label}`)
    const key=`${group.groupKey}:${group.method}`
    if(seen.has(key))throw new Error(`QL 来源含重复组别：${label}`)
    seen.add(key)
    if(cells[4]!=='OK')throw new Error(`QL 第 ${sourceRow} 行尚未复核为 OK。`)
    const oldPriceCentsPerKg=qlMoneyToCents(cells[1])
    const changeCentsPerKg=qlAdjustmentToCents(cells[2])
    const priceCentsPerKg=qlMoneyToCents(cells[3])
    if(oldPriceCentsPerKg+changeCentsPerKg!==priceCentsPerKg)
      throw new Error(`QL 第 ${sourceRow} 行原价加调整不等于新价。`)
    return Object.freeze({...group,sourceRow,aliases:Object.freeze([...group.aliases]),oldPriceCentsPerKg,changeCentsPerKg,priceCentsPerKg})
  })
  if(seen.size!==groups.length)throw new Error('QL 来源缺少已批准组别。')
  return Object.freeze({version:input.version,effectiveDate,source:Object.freeze({...QL_SOURCE,title}),rows:Object.freeze(rows)})
}

export const QL_SEED_VERSION=validateQlSheet(seedSheet)

const rowKey=(row:QlPriceRow)=>`${row.groupKey}:${row.method}`
const rowContent=(row:QlPriceRow)=>JSON.stringify([row.groupKey,row.label,row.aliases,row.method,row.oldPriceCentsPerKg,row.changeCentsPerKg,row.priceCentsPerKg])
const versionContent=(version:QlPriceVersion)=>JSON.stringify([version.effectiveDate,version.source,
  [...version.rows].sort((a,b)=>rowKey(a).localeCompare(rowKey(b))).map(rowContent)])

export function diffQlVersions(before:QlPriceVersion|null,after:QlPriceVersion):QlPriceDiff {
  const oldRows=new Map(before?.rows.map(row=>[rowKey(row),row])??[])
  const newRows=new Map(after.rows.map(row=>[rowKey(row),row]))
  const changes:QlPriceChange[]=[]
  for(const [key,row] of newRows){
    const previous=oldRows.get(key)??null
    if(!previous||rowContent(previous)!==rowContent(row))changes.push({key,kind:previous?'changed':'added',before:previous,after:row})
  }
  for(const [key,row] of oldRows)if(!newRows.has(key))changes.push({key,kind:'removed',before:row,after:null})
  const aliases=new Map<string,Set<string>>()
  for(const row of after.rows)for(const alias of row.aliases){
    if(!aliases.has(alias))aliases.set(alias,new Set())
    aliases.get(alias)!.add(row.method)
  }
  const warnings=[...aliases].filter(([,methods])=>methods.size>1)
    .map(([alias])=>`${alias} 涉及不同作业方式，必须选择具体组别。`)
  warnings.push('红/乌目林仔、中/白月仔保留来源组别；不自动扩展简称。')
  return {changes,warnings}
}

/** New versions append only. Same source content is idempotent; changed IDs/dates require review. */
export function addQlVersion(history:readonly QlPriceVersion[],incoming:QlPriceVersion):readonly QlPriceVersion[] {
  const sameId=history.find(version=>version.version===incoming.version)
  if(sameId){
    if(versionContent(sameId)!==versionContent(incoming))throw new Error('QL 已有版本内容改变，不能覆盖历史。')
    return history
  }
  const sameDate=history.find(version=>version.effectiveDate===incoming.effectiveDate)
  if(sameDate){
    if(versionContent(sameDate)===versionContent(incoming))return history
    throw new Error('QL 相同生效日期存在不同价格，须复核新版本。')
  }
  return Object.freeze([...history,incoming].sort((a,b)=>a.effectiveDate.localeCompare(b.effectiveDate)))
}

/** A document's business date selects its reference; saved document snapshots remain authoritative. */
export function selectQlVersion(history:readonly QlPriceVersion[],businessDate:string):QlPriceVersion|null {
  requireDate(businessDate)
  let selected:QlPriceVersion|null=null
  for(const version of history){
    if(version.effectiveDate>businessDate)continue
    if(selected&&version.effectiveDate===selected.effectiveDate&&versionContent(version)!==versionContent(selected))
      throw new Error('QL 生效日期存在冲突版本。')
    if(!selected||version.effectiveDate>selected.effectiveDate)selected=version
  }
  return selected
}

/** Exact catalogue aliases only; absence of a method cannot silently choose a context. */
export function matchQlPrice(version:QlPriceVersion,name:string,method?:QlMethod):{status:'matched'|'review-needed',candidates:QlPriceRow[]} {
  const clean=name.trim()
  const candidates=version.rows.filter(row=>(row.label===clean||row.aliases.includes(clean))&&(!method||row.method===method))
  return {status:candidates.length===1?'matched':'review-needed',candidates}
}
