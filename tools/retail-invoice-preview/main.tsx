import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { RetailReceipt, RetailReceiptActions } from '../../src/components/RetailReceipt'
import type { RetailLine, RetailSale } from '../../src/lib/retailSales'
import '../../src/styles.css'
import '../../src/pages/retailSales.css'

const shortLines: RetailLine[] = [
  { fishId: 'preview-1', chineseName: '金线', malayName: 'Ikan Kerisi', weightDeciKg: 805, unitPriceCents: 1200, amountCents: 96600 },
  { fishId: 'preview-2', chineseName: '大眼金鱼', malayName: 'Ikan Mata Besar', weightDeciKg: 25, unitPriceCents: 830, amountCents: 2075 },
]
const shortSale: RetailSale = {
  id: 'LOCAL-PREVIEW-ONLY-001', businessDate: '07/09/2026', dateSortKey: 20260907,
  vendorName: '测试小贩阿明', lines: shortLines, totalAmountCents: 98675,
  createdAt: { toDate: () => new Date('2026-09-07T02:30:00Z') },
}
const longLines: RetailLine[] = Array.from({ length: 20 }, (_, index) => ({
  fishId: `preview-long-${index + 1}`,
  chineseName: `测试鱼种${index + 1}号金线鱼中文长名称用于检查换行与跨页排版`.repeat(2),
  malayName: `Ikan contoh ${index + 1} nama panjang untuk semakan susun atur dan halaman invois`,
  weightDeciKg: 3000, unitPriceCents: 1000000, amountCents: 300000000,
}))
const longSale: RetailSale = {
  ...shortSale, id: 'LOCAL-PREVIEW-ONLY-020',
  vendorName: '测试小贩中文长名称阿明海鲜门市验收样本'.repeat(4),
  lines: longLines, totalAmountCents: 6000000000,
}

export function Preview() {
  const [longInvoice, setLongInvoice] = useState(false)
  const sale = longInvoice ? longSale : shortSale
  return <main className="retail-page">
    <section className="retail-no-print" aria-label="本地验收设置">
      <h1>门市发票 · 本地验收</h1>
      <p>固定测试样本，不连接 Firebase，不会保存销售记录。</p>
      <p>安全连接：{window.isSecureContext ? '已启用' : '未启用；iPhone 文件分享需要可信任的 HTTPS'}</p>
      <div className="retail-actions">
        <button onClick={() => setLongInvoice(false)} aria-pressed={!longInvoice}>普通发票（2 行）</button>
        <button onClick={() => setLongInvoice(true)} aria-pressed={longInvoice}>长发票（20 行 / 长名称 / 大金额）</button>
      </div>
    </section>
    <RetailReceipt sale={sale} />
    <RetailReceiptActions sale={sale} />
  </main>
}

createRoot(document.getElementById('root')!).render(<Preview />)
