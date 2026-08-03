export const fishHeadNoLoanVesselCodes = ['978','5202'] as const
export const fishHeadNoLoanPremiumCents = 5
export const fishMealNoLoanVesselCodes = ['978','1785','5202'] as const
export const fishMealNoLoanPremiumCents = 3

const fishHeadPriceDefinitions = [
  ['大目力',315],['大中目力',295],['中目力',275],['目力仔(白肉)',250],['戈里/黄线仔/泥仔',355],
  ['戈里仔',200],['中金里/金里仔',210],['红目林',275],['乌目林',160],['红/乌目林仔',140],
  ['黄麻鱼',380],['幼麻仔鱼',245],['红条/香麻鱼',260],['白头',275],['加仔/刀仔',255],
  ['利仔',220],['牛尾/中牛尾',255],['红沙占/白沙占',255],['来戈',245],['小来戈',175],
  ['大黄甲/刀力',230],['肉竹仔',225],['肉江（鱼）',200],['银鱼',200],['大眼金鱼/红加',240],
  ['金线',205],['金线仔',150],['红丁',205],['中/白月仔/牛腩',190],['目孔（黑肉）',190],
  ['拖网加码',190],['拖网丁温',190],['咯咯/古古/金古/沙仔/沙条/三板仔',175],
  ['竹占/水占仔/白竹占/石头鱼/白皂/飞鱼/香鱼/米仔仔/娃娃鱼/红水占',175],
  ['牛尾仔',170],['旗鱼',170],['白代仔',135],
] as const

export const fishHeadBasePrices:Readonly<Record<string,number>>=Object.freeze(
  Object.fromEntries(fishHeadPriceDefinitions.flatMap(([names,cents])=>names.split('/').map(name=>[name,cents])))
)

export const fishMealBasePrices:Readonly<Record<'bucket'|'bag',number>>=Object.freeze({bucket:75,bag:70})

export function getDefaultFishHeadPriceCents(displayName:string,vesselCode:string):number|null {
  const base=fishHeadBasePrices[displayName.trim()]
  if (base===undefined) return null
  return base+(fishHeadNoLoanVesselCodes.includes(vesselCode.trim() as (typeof fishHeadNoLoanVesselCodes)[number])?fishHeadNoLoanPremiumCents:0)
}

export function getDefaultFishMealPriceCents(quality:'bucket'|'bag',vesselCode:string):number {
  return fishMealBasePrices[quality]+(fishMealNoLoanVesselCodes.includes(vesselCode.trim() as (typeof fishMealNoLoanVesselCodes)[number])?fishMealNoLoanPremiumCents:0)
}
