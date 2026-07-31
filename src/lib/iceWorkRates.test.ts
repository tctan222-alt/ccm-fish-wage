import { describe, expect, it } from 'vitest'
import { businessDateFromLegacy, monthKeyFromBusinessDate, monthSortKeyFromMonthKey, sortKeyFromBusinessDate } from './businessDate'
import { createIceWorkRecord } from './iceWork'

const record=(input:Record<string,number>)=>createIceWorkRecord({id:'r',workDate:'31/07/2026',vesselId:'978',vesselCodeSnapshot:'978',createdBy:'u',...input})
describe('冰工固定费率',()=>{
  it.each([[1_000,10],[125_500,1_255],[1_000_000,10_000],[0,0],[1,0],[50_050,501]])('木斑什 %i 克 = %i 分',(factoryIncomingWeightGrams,expected)=>expect(record({factoryIncomingWeightGrams}).factoryIncomingAmountCents).toBe(expected))
  it.each([[1,1_500],[2,3_000],[3,4_500],[5,7_500],[0,0],[20,30_000]])('冰箱 %i 半单位 = %i 分',(iceBoxHalfUnits,expected)=>expect(record({iceBoxHalfUnits}).iceBoxAmountCents).toBe(expected))
  it.each([[500,1],[100_000,200],[125_500,251],[1,0],[750,2],[1_000,2]])('柴油 %i mL = %i 分',(dieselVolumeMilliliters,expected)=>expect(record({dieselVolumeMilliliters}).dieselAmountCents).toBe(expected))
  it.each([[80_000,2_400],[125_500,3_765],[1,0],[500,15],[1_000,30],[10_000,300]])('小贩 %i 克 = %i 分',(hawkerSaleWeightGrams,expected)=>expect(record({hawkerSaleWeightGrams}).hawkerSaleAmountCents).toBe(expected))
  it.each([[0,0],[1,1_350],[2,2_700],[10,13_500]])('直接买冰 %i 条 = %i 分',(directIceBarCount,expected)=>expect(record({directIceBarCount}).directIceAmountCents).toBe(expected))
  it.each([[0,0],[1,140],[10,1_400],[100,14_000]])('塑料袋 %i 个 = %i 分',(plasticBagCount,expected)=>expect(record({plasticBagCount}).plasticBagAmountCents).toBe(expected))
})
describe('日期排序键',()=>{
  it.each([
    ['2026-01-01','01/01/2026',20260101,'01/2026',202601],['2026-02-28','28/02/2026',20260228,'02/2026',202602],
    ['2028-02-29','29/02/2028',20280229,'02/2028',202802],['2026-03-31','31/03/2026',20260331,'03/2026',202603],
    ['2026-04-30','30/04/2026',20260430,'04/2026',202604],['2026-05-01','01/05/2026',20260501,'05/2026',202605],
    ['2026-06-15','15/06/2026',20260615,'06/2026',202606],['2026-07-31','31/07/2026',20260731,'07/2026',202607],
    ['2026-08-01','01/08/2026',20260801,'08/2026',202608],['2026-09-30','30/09/2026',20260930,'09/2026',202609],
    ['2026-10-01','01/10/2026',20261001,'10/2026',202610],['2026-11-30','30/11/2026',20261130,'11/2026',202611],
    ['2026-12-31','31/12/2026',20261231,'12/2026',202612],['2027-01-01','01/01/2027',20270101,'01/2027',202701],
    ['2030-12-31','31/12/2030',20301231,'12/2030',203012],['2024-02-29','29/02/2024',20240229,'02/2024',202402],
    ['2025-02-28','28/02/2025',20250228,'02/2025',202502],['2026-07-09','09/07/2026',20260709,'07/2026',202607],
    ['2026-07-10','10/07/2026',20260710,'07/2026',202607],['2026-12-01','01/12/2026',20261201,'12/2026',202612],
  ])('%s becomes canonical date and sort keys',(legacy,date,dateSort,month,monthSort)=>{const canonical=businessDateFromLegacy(legacy);expect(canonical).toBe(date);expect(sortKeyFromBusinessDate(canonical)).toBe(dateSort);expect(monthKeyFromBusinessDate(canonical)).toBe(month);expect(monthSortKeyFromMonthKey(month)).toBe(monthSort)})
})
