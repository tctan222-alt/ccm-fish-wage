import { describe,expect,it } from 'vitest'
import seed from '../data/qlPrices20261010.json'
import {
  QL_SEED_VERSION,QL_SOURCE,addQlVersion,diffQlVersions,matchQlPrice,
  qlAdjustmentToCents,qlMoneyToCents,selectQlVersion,validateQlSheet,
} from './qlPrices'
import { fishHeadMasterBasePriceCents } from './fishHeadMasterPrice'

const sheet=()=>structuredClone(seed)
const futureSheet=(date='2026-11-01')=>{
  const input=sheet()
  input.effectiveDate=date
  input.version=`ql-foods-${date}`
  input.source.title=`QL Foods 鱼头价格表 ${date}`
  input.values[1][1]=date
  input.values[3]=['大目力',3.15,0.15,3.30,'OK']
  return input
}

describe('QL Foods approved customer price reference',()=>{
  it('contains all 36 exact source labels and approved effective cents',()=>{
    const expected:[string,number][]=[
      ['大目力',315],['大中目力',295],['中目力',275],['目力仔(白肉)',250],['戈里仔/黄线仔/记仔',365],['小戈里仔',210],
      ['中金里/金里仔',210],['红目林',275],['乌目林',180],['红/乌目林仔',140],['黄麻鱼',390],['幼麻仔鱼',255],
      ['红条/香蕉鱼/白头/英哥鱼',280],['加仔/刀仔',260],['利仔',220],['牛尾/中牛尾',265],['红沙占/白沙占',265],
      ['来戈',245],['来戈仔',175],['大黄甲/刀力/肉竹仔',235],['肉江/银鱼',210],['红丁/金线/大眼金鱼/红加',210],
      ['金线仔',155],['中/白月仔/牛南',200],['加晒/丁温/目孔(拖网)',200],['咯咯/古古/金古/沙仔/沙条/三板仔',180],
      ['竹占/水占仔/白竹占/石头鱼/白皂/飞鱼/香鱼/米午仔/娃娃鱼/红水占',180],['牛尾仔',180],['旗鱼',180],['白代仔',145],
      ['朱力/拉仔/色拉/青兰/大目',90],['白鱼/水昌仔/只仔/什鱼/目洛',90],['硬尾/斧头鱼',90],
      ['次鱼/沙毛/树叶/甲仔/伍支秋/九沙/鱼仔',80],['丁温/目孔/加西（底船）',210],['青兰（底船）',110],
    ]
    expect(QL_SEED_VERSION.rows.map(row=>[row.label,row.priceCentsPerKg])).toEqual(expected)
    expect(QL_SEED_VERSION.rows.map(row=>row.sourceRow)).toEqual(Array.from({length:36},(_,i)=>i+4))
    expect(new Set(QL_SEED_VERSION.rows.map(row=>`${row.groupKey}:${row.method}`)).size).toBe(36)
    expect(QL_SEED_VERSION.source).toEqual({...QL_SOURCE,title:'QL Foods 鱼头价格表 2026-10-10'})
  })
  it('has exactly 22 raised and 14 unchanged rows with exact old + adjustment arithmetic',()=>{
    expect(QL_SEED_VERSION.rows.filter(row=>row.changeCentsPerKg>0)).toHaveLength(22)
    expect(QL_SEED_VERSION.rows.filter(row=>row.changeCentsPerKg===0)).toHaveLength(14)
    for(const row of QL_SEED_VERSION.rows){
      expect(Number.isSafeInteger(row.priceCentsPerKg)).toBe(true)
      expect(row.oldPriceCentsPerKg+row.changeCentsPerKg).toBe(row.priceCentsPerKg)
    }
  })
  it.each([
    ['丁温','trawl',200],['丁温','bottom',210],['目孔','trawl',200],['目孔','bottom',210],
    ['青兰','general',90],['青兰','bottom',110],['鱼仔','general',80],
  ] as const)('requires the applicable %s / %s context',(name,method,cents)=>{
    const result=matchQlPrice(QL_SEED_VERSION,name,method)
    expect(result.status).toBe('matched')
    expect(result.candidates[0].priceCentsPerKg).toBe(cents)
  })
  it.each(['丁温','目孔','青兰'])('requires user choice when %s has multiple contexts',name=>{
    expect(matchQlPrice(QL_SEED_VERSION,name)).toMatchObject({status:'review-needed'})
    expect(matchQlPrice(QL_SEED_VERSION,name).candidates).toHaveLength(2)
  })
  it.each(['红','乌目林仔','红目林仔','中','未知鱼',''])('never guesses shorthand or unknown alias %s',name=>{
    expect(matchQlPrice(QL_SEED_VERSION,name)).toEqual({status:'review-needed',candidates:[]})
  })
  it('keeps ambiguous shorthand intact as a selectable source group',()=>{
    expect(matchQlPrice(QL_SEED_VERSION,'红/乌目林仔').candidates[0].label).toBe('红/乌目林仔')
    expect(matchQlPrice(QL_SEED_VERSION,'中/白月仔/牛南').candidates[0].label).toBe('中/白月仔/牛南')
  })
  it('does not apply purchase defaults or the 978/5202 premium to QL prices',()=>{
    const purchaseBefore=fishHeadMasterBasePriceCents({displayName:'金线'})
    expect(matchQlPrice(QL_SEED_VERSION,'金线').candidates[0].priceCentsPerKg).toBe(210)
    expect(fishHeadMasterBasePriceCents({displayName:'金线'})).toBe(purchaseBefore)
    expect(purchaseBefore).toBe(205)
    expect(matchQlPrice(QL_SEED_VERSION,'978')).toEqual({status:'review-needed',candidates:[]})
    expect(matchQlPrice(QL_SEED_VERSION,'5202')).toEqual({status:'review-needed',candidates:[]})
  })
})

describe('QL source ingestion validation',()=>{
  it.each([['0.29',29],['RM 3.15',315],[3.65,365],['2.1',210],['+RM 0.05',5]] as const)(
    'parses %s as exact cents %s',(input,expected)=>expect(qlMoneyToCents(input)).toBe(expected))
  it.each(['0.295','3.15000001','-1','Infinity','1e2','',null,undefined,{},NaN])(
    'rejects malformed or inexact money %s',input=>expect(()=>qlMoneyToCents(input)).toThrow())
  it('accepts only explicit unchanged markers as zero adjustment',()=>{
    expect(qlMoneyToCents('-',true)).toBe(0)
    expect(qlMoneyToCents('—',true)).toBe(0)
    expect(()=>qlMoneyToCents(null,true)).toThrow()
    expect(()=>qlMoneyToCents('',true)).toThrow()
    expect(()=>qlMoneyToCents(0)).toThrow()
  })
  it('supports signed future adjustments without silently rounding sub-cent source data',()=>{
    expect(qlAdjustmentToCents('-0.05')).toBe(-5)
    expect(qlAdjustmentToCents('-RM 0.10')).toBe(-10)
    expect(qlAdjustmentToCents('RM -0.10')).toBe(-10)
    expect(qlAdjustmentToCents('+RM 0.05')).toBe(5)
    expect(qlAdjustmentToCents(-0.29)).toBe(-29)
    expect(()=>qlAdjustmentToCents('-0.295')).toThrow()
    expect(()=>qlAdjustmentToCents(null)).toThrow()
    expect(()=>qlMoneyToCents('100000.01')).toThrow()
    expect(()=>qlMoneyToCents('9007199254740993')).toThrow()
    expect(qlMoneyToCents('100000.00')).toBe(10000000)
  })
  it.each([null,{}, {source:null}])('rejects a missing source envelope',input=>expect(()=>validateQlSheet(input)).toThrow())
  it('rejects a different spreadsheet/range and never trusts a supplied external URL',()=>{
    const input=sheet(); input.source.spreadsheetId='another-sheet'
    expect(()=>validateQlSheet(input)).toThrow(/来源/)
    const wrongRange=sheet();wrongRange.source.range='Sheet2!A1:E39'
    expect(()=>validateQlSheet(wrongRange)).toThrow(/来源/)
    const withURL={...sheet(),source:{...sheet().source,url:'https://attacker.invalid'}}
    expect(validateQlSheet(withURL).source.url).toBe(QL_SOURCE.url)
  })
  it.each(['2026-02-30','2026-13-01','2026-1-01','not-a-date'])('rejects invalid effective date %s',date=>{
    const input=futureSheet(date)
    expect(()=>validateQlSheet(input)).toThrow(/日期/)
  })
  it('ties date/version/title to the actual source date header',()=>{
    const title=sheet();title.source.title='Another title';expect(()=>validateQlSheet(title)).toThrow(/标题/)
    const date=sheet();date.values[1][1]='2026-10-11';expect(()=>validateQlSheet(date)).toThrow(/表头/)
    const version=sheet();version.version='ql-foods-2026-10-11';expect(()=>validateQlSheet(version)).toThrow(/版本/)
    const header=sheet();header.values[2][2]='新价格';expect(()=>validateQlSheet(header)).toThrow(/表头/)
  })
  it.each([
    (input:ReturnType<typeof sheet>)=>{input.values.pop()},
    (input:ReturnType<typeof sheet>)=>{input.values[3]=[]},
    (input:ReturnType<typeof sheet>)=>{input.values[3][1]=null as unknown as string},
    (input:ReturnType<typeof sheet>)=>{input.values[3][4]='ERROR'},
    (input:ReturnType<typeof sheet>)=>{input.values[3][3]=3.16},
    (input:ReturnType<typeof sheet>)=>{input.values[4]=input.values[3]},
    (input:ReturnType<typeof sheet>)=>{input.values[3][0]='新鱼种（底船）'},
  ])('fails closed for incomplete, null, unverified, inconsistent, duplicate or new-context rows',change=>{
    const input=sheet();change(input);expect(()=>validateQlSheet(input)).toThrow()
  })
  it('keeps stable group identities when source rows are reordered',()=>{
    const input=sheet();[input.values[3],input.values[4]]=[input.values[4],input.values[3]]
    const reordered=validateQlSheet(input)
    expect(reordered.rows[0].groupKey).toBe(QL_SEED_VERSION.rows[1].groupKey)
    expect(reordered.rows[0].sourceRow).toBe(4)
    expect(diffQlVersions(QL_SEED_VERSION,reordered).changes).toHaveLength(0)
    expect(addQlVersion([QL_SEED_VERSION],reordered)).toEqual([QL_SEED_VERSION])
  })
})

describe('QL immutable effective versions and reconciliation',()=>{
  it('starts precisely on the approved business date, without inventing older prices',()=>{
    expect(selectQlVersion([QL_SEED_VERSION],'2026-10-09')).toBeNull()
    expect(selectQlVersion([QL_SEED_VERSION],'2026-10-10')).toBe(QL_SEED_VERSION)
    expect(()=>selectQlVersion([QL_SEED_VERSION],'2026-02-30')).toThrow()
  })
  it('appends future prices without changing history or existing document snapshots',()=>{
    const savedSnapshot={businessDate:'2026-10-12',version:QL_SEED_VERSION.version,priceCentsPerKg:315}
    const previous=JSON.stringify(QL_SEED_VERSION)
    const future=validateQlSheet(futureSheet())
    const history=addQlVersion([QL_SEED_VERSION],future)
    expect(selectQlVersion([...history].reverse(),'2026-10-31')).toBe(QL_SEED_VERSION)
    expect(selectQlVersion(history,'2026-11-01')).toBe(future)
    expect(JSON.stringify(QL_SEED_VERSION)).toBe(previous)
    expect(savedSnapshot).toEqual({businessDate:'2026-10-12',version:'ql-foods-2026-10-10',priceCentsPerKg:315})
    expect(Object.isFrozen(QL_SEED_VERSION.rows[0].aliases)).toBe(true)
    expect(Object.isFrozen(QL_SEED_VERSION.rows[0])).toBe(true)
    expect(Object.isFrozen(history)).toBe(true)
  })
  it('shows exact before/after changes and context warnings before accepting a version',()=>{
    const next=validateQlSheet(futureSheet())
    const diff=diffQlVersions(QL_SEED_VERSION,next)
    expect(diff.changes).toHaveLength(1)
    expect(diff.changes[0]).toMatchObject({kind:'changed',before:{priceCentsPerKg:315},after:{priceCentsPerKg:330}})
    expect(diff.warnings.some(warning=>warning.includes('丁温'))).toBe(true)
    expect(diff.warnings.some(warning=>warning.includes('青兰'))).toBe(true)
    expect(diff.warnings.some(warning=>warning.includes('红/乌目林仔'))).toBe(true)
    expect(diffQlVersions(QL_SEED_VERSION,QL_SEED_VERSION).changes).toHaveLength(0)
  })
  it('ingests a later decrease through the same pipeline while preserving positive new prices',()=>{
    const input=futureSheet()
    input.values[3]=['大目力',3.15,-0.10,3.05,'OK']
    const next=validateQlSheet(input)
    expect(next.rows[0]).toMatchObject({oldPriceCentsPerKg:315,changeCentsPerKg:-10,priceCentsPerKg:305})
    expect(diffQlVersions(QL_SEED_VERSION,next).changes[0].after?.priceCentsPerKg).toBe(305)
    input.values[3]=['大目力',3.15,-3.15,0,'OK']
    expect(()=>validateQlSheet(input)).toThrow()
  })
  it('is idempotent for repeated reads and rejects changed content under an existing version/date',()=>{
    const history=[QL_SEED_VERSION]
    expect(addQlVersion(history,validateQlSheet(sheet()))).toBe(history)
    const changed=futureSheet('2026-10-10')
    expect(()=>addQlVersion(history,validateQlSheet(changed))).toThrow(/不能覆盖历史/)
    changed.version+='-revision2'
    expect(()=>addQlVersion(history,validateQlSheet(changed))).toThrow(/相同生效日期/)
    const sameContent=sheet();sameContent.version+='-same'
    expect(addQlVersion(history,validateQlSheet(sameContent))).toBe(history)
  })
  it('fails on contradictory same-date history instead of choosing array order',()=>{
    const changed=validateQlSheet(futureSheet('2026-10-10'))
    expect(()=>selectQlVersion([QL_SEED_VERSION,changed],'2026-11-01')).toThrow(/冲突版本/)
  })
})
