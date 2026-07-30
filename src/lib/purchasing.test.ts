import { describe,expect,it } from 'vitest'
import {
  DEFAULT_PURCHASE_CATEGORIES,
  activePurchaseCategories,
  activeVessels,
  applyPurchasePayment,
  assertPaymentCanVoid,
  assertPurchaseReceiptLineLimits,
  buildDefaultCategoryCreates,
  buildPaymentGroup,
  calculateReceiptTotals,
  confirmReceipt,
  duplicateExternalSlip,
  duplicateVesselCode,
  kgInputToGrams,
  paymentStatus,
  supplierMonthlySummary,
  rmInputToCentsPerKg,
  validateCategoryInput,
  validateVesselInput,
  voidPurchasePayment,
  voidReceipt,
  type PurchaseReceipt,
} from './purchasing'

const lines=[
  {id:'l1',lineNo:1,categoryId:'c1',categoryCodeSnapshot:'fish_head',categoryNameSnapshot:'鱼头',basketCount:2,weightGrams:12500,unitPriceCentsPerKg:123,amountCents:1538,notes:''},
  {id:'l2',lineNo:2,categoryId:'c2',categoryCodeSnapshot:'fish_meal',categoryNameSnapshot:'鱼仔',basketCount:0,weightGrams:1025,unitPriceCentsPerKg:200,amountCents:205,notes:''},
]
const receipt=(overrides:Partial<PurchaseReceipt>={}):PurchaseReceipt=>({
  id:'r1',receiptCode:'RC-12345678',receiptDate:'2026-07-30',monthKey:'2026-07',externalSlipNo:'C3988',
  supplierId:'s1',supplierCodeSnapshot:'BP-SUPPLIER',supplierNameSnapshot:'Ocean Supply',
  vesselId:'v1',vesselCodeSnapshot:'2031',vesselNameSnapshot:'Boat 2031',status:'draft',
  lineCount:2,totalBasketCount:2,totalWeightGrams:13525,totalAmountCents:1743,paidCents:0,paymentStatus:'unpaid',
  notes:'',duplicateAcknowledged:false,lines,...overrides,
})

describe('purchase receiving domain',()=>{
  it('maps fish head and fish meal to the required Chinese display names',()=>{
    expect(DEFAULT_PURCHASE_CATEGORIES.find(item=>item.categoryCode==='fish_head')?.displayName).toBe('鱼头')
    expect(DEFAULT_PURCHASE_CATEGORIES.find(item=>item.categoryCode==='fish_meal')?.displayName).toBe('鱼仔')
  })

  it('initializes only missing default category codes',()=>{
    const creates=buildDefaultCategoryCreates([{id:'existing',categoryCode:'fish_head',displayName:'鱼头',active:true,order:0,notes:''}])
    expect(creates).toHaveLength(8)
    expect(creates.some(item=>item.categoryCode==='fish_head')).toBe(false)
  })

  it('excludes inactive categories from new receipt selection',()=>{
    expect(activePurchaseCategories([
      {id:'a',categoryCode:'fish_head',displayName:'鱼头',active:true,order:0,notes:''},
      {id:'b',categoryCode:'fish_meal',displayName:'鱼仔',active:false,order:1,notes:''},
    ]).map(item=>item.id)).toEqual(['a'])
  })

  it('calculates line amount using half-up integer rounding',()=>{
    expect(calculateReceiptTotals([{...lines[0],weightGrams:1500,unitPriceCentsPerKg:101,basketCount:1}])).toEqual({
      lineCount:1,totalBasketCount:1,totalWeightGrams:1500,totalAmountCents:152,
    })
  })

  it('calculates multi-line grams, baskets, and cents totals',()=>{
    expect(calculateReceiptTotals(lines)).toEqual({
      lineCount:2,totalBasketCount:2,totalWeightGrams:13525,totalAmountCents:1743,
    })
  })

  it('keeps the maximum supported grams and price multiplication within safe integer precision',()=>{
    expect(calculateReceiptTotals([{...lines[0],weightGrams:100_000_000,unitPriceCentsPerKg:10_000_000}]).totalAmountCents).toBe(1_000_000_000_000)
  })

  it('rejects grams or cents-per-kg beyond the precision-safe business limits',()=>{
    expect(()=>calculateReceiptTotals([{...lines[0],weightGrams:100_000_001}])).toThrow('100,000,000')
    expect(()=>calculateReceiptTotals([{...lines[0],unitPriceCentsPerKg:10_000_001}])).toThrow('10,000,000')
  })

  it('allows the conservative Firestore access budget of twelve distinct categories',()=>{
    expect(()=>assertPurchaseReceiptLineLimits(Array.from({length:12},(_,index)=>({...lines[0],id:`l${index}`,categoryId:`c${index}`})))).not.toThrow()
  })

  it('rejects a thirteenth distinct category before starting an atomic receipt write',()=>{
    expect(()=>assertPurchaseReceiptLineLimits(Array.from({length:13},(_,index)=>({...lines[0],id:`l${index}`,categoryId:`c${index}`})))).toThrow('12 distinct')
  })

  it('confirms a draft with supplier and vessel kept separate and snapshots intact',()=>{
    const confirmed=confirmReceipt(receipt())
    expect(confirmed).toMatchObject({status:'confirmed',supplierId:'s1',vesselId:'v1',supplierNameSnapshot:'Ocean Supply',vesselNameSnapshot:'Boat 2031'})
  })

  it('rejects confirming a receipt without lines or confirming twice',()=>{
    expect(()=>confirmReceipt(receipt({lines:[]}))).toThrow('at least one line')
    expect(()=>confirmReceipt(receipt({status:'confirmed'}))).toThrow('Draft')
  })

  it('voids a confirmed unpaid receipt but retains the record',()=>{
    expect(voidReceipt(receipt({status:'confirmed'}),' wrong vessel ')).toMatchObject({id:'r1',status:'voided',voidReason:'wrong vessel'})
  })

  it('blocks void when payments remain and validates reason length',()=>{
    expect(()=>voidReceipt(receipt({status:'confirmed',paidCents:1}),'wrong')).toThrow('payments')
    expect(()=>voidReceipt(receipt({status:'confirmed'}),'no')).toThrow('3 to 100')
  })

  it('warns on a duplicate external slip without automatically blocking it',()=>{
    expect(duplicateExternalSlip(' c3988 ',[receipt({status:'confirmed'})])).toBe(true)
  })

  it.each([[0,1000,'unpaid'],[1,1000,'partial'],[1000,1000,'paid']] as const)(
    'derives payment status %s/%s as %s',(paid,total,status)=>expect(paymentStatus(paid,total)).toBe(status),
  )

  it('applies partial and full payments without exceeding balance',()=>{
    expect(applyPurchasePayment(receipt({status:'confirmed'}),500)).toMatchObject({paidCents:500,paymentStatus:'partial'})
    expect(applyPurchasePayment(receipt({status:'confirmed'}),1743)).toMatchObject({paidCents:1743,paymentStatus:'paid'})
    expect(()=>applyPurchasePayment(receipt({status:'confirmed',paidCents:1700}),100)).toThrow('balance')
  })

  it('voids a payment once and never reduces paid cents below zero',()=>{
    expect(voidPurchasePayment(receipt({status:'confirmed',paidCents:500,paymentStatus:'partial'}),500)).toMatchObject({paidCents:0,paymentStatus:'unpaid'})
    expect(()=>voidPurchasePayment(receipt({status:'confirmed',paidCents:0}),500)).toThrow('below zero')
  })

  it('supplier monthly summary includes confirmed only and excludes voided',()=>{
    const result=supplierMonthlySummary([
      receipt({id:'confirmed',status:'confirmed'}),
      receipt({id:'voided',status:'voided',totalAmountCents:99999}),
      receipt({id:'draft',status:'draft',totalAmountCents:88888}),
    ],'2026-07','s1')
    expect(result).toMatchObject({receiptCount:1,totalWeightGrams:13525,grossCents:1743,paidCents:0,outstandingCents:1743})
  })

  it('contains exactly the nine required default purchase categories',()=>{
    expect(DEFAULT_PURCHASE_CATEGORIES).toHaveLength(9)
    expect(DEFAULT_PURCHASE_CATEGORIES.map(item=>item.categoryCode)).toContain('dai_zai')
  })

  it.each([['1',1000],['1.2',1200],['1.025',1025]] as const)(
    'converts kg input %s to integer grams %s',(input,grams)=>expect(kgInputToGrams(input)).toBe(grams),
  )

  it('rejects weight input beyond three decimals',()=>{
    expect(()=>kgInputToGrams('1.0001')).toThrow('3 decimal')
  })

  it.each([['1',100],['1.2',120],['1.23',123]] as const)(
    'converts RM/kg input %s to cents %s',(input,cents)=>expect(rmInputToCentsPerKg(input)).toBe(cents),
  )

  it('validates category codes and immutable-style normalized inputs',()=>{
    expect(validateCategoryInput({categoryCode:'Fish Head',displayName:'',order:-1,notes:''})).toHaveLength(3)
    expect(validateCategoryInput({categoryCode:'fish_head',displayName:'鱼头',order:0,notes:''})).toEqual([])
  })

  it('validates vessel code and name limits',()=>{
    expect(validateVesselInput({vesselCode:'',displayName:'',defaultSupplierId:'',defaultSupplierNameSnapshot:'',notes:''})).toHaveLength(2)
  })

  it('warns about duplicate vessel codes without hiding inactive history',()=>{
    const vessels=[{id:'v1',vesselCode:'2031',displayName:'Boat',defaultSupplierId:'',defaultSupplierNameSnapshot:'',active:false,notes:''}]
    expect(duplicateVesselCode(' 2031 ',vessels)).toBe(true)
    expect(activeVessels(vessels)).toEqual([])
  })

  it('builds one full-balance payment per selected receipt under one group',()=>{
    const group=buildPaymentGroup([receipt({id:'a',status:'confirmed',paidCents:43}),receipt({id:'b',status:'confirmed',paidCents:0})],'group-1')
    expect(group).toEqual([{receiptId:'a',amountCents:1700,paymentGroupId:'group-1'},{receiptId:'b',amountCents:1743,paymentGroupId:'group-1'}])
  })

  it('rejects already paid or non-confirmed receipts in a selected payment group',()=>{
    expect(()=>buildPaymentGroup([receipt({status:'confirmed',paidCents:1743})],'g')).toThrow('outstanding')
    expect(()=>buildPaymentGroup([receipt({status:'draft'})],'g')).toThrow('Confirmed')
  })

  it('blocks voiding the same payment twice',()=>{
    expect(()=>assertPaymentCanVoid({id:'p1',paymentGroupId:'g',receiptId:'r1',receiptCode:'RC-1',supplierId:'s1',
      supplierNameSnapshot:'Historical Supplier',amountCents:100,method:'bank',paymentDate:'2026-07-30',reference:'',note:'',
      createdBy:'u1',voided:true,voidReason:'wrong payment',voidedBy:'u1'})).toThrow('already voided')
  })

  it('keeps confirmed historical supplier, vessel, and category names as snapshots',()=>{
    const old=confirmReceipt(receipt())
    expect([old.supplierNameSnapshot,old.vesselNameSnapshot,old.lines[0].categoryNameSnapshot]).toEqual(['Ocean Supply','Boat 2031','鱼头'])
  })
})
