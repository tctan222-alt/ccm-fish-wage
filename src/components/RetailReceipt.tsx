import { useEffect, useState } from 'react'
import { formatRetailAuditTimestamp, formatRetailDate } from '../lib/retailDate'
import { retailMoney, retailWeightKg, type RetailSale } from '../lib/retailSales'
import { createRetailInvoicePdf } from '../lib/retailInvoicePdf'

export function RetailReceipt({ sale }: { sale: RetailSale }) {
  return <section className="retail-receipt" aria-label="门市现金结算单"><h2>门市现金结算单</h2><p>日期 Date：{formatRetailDate(sale.businessDate)}</p><p>小贩 Vendor：{sale.vendorName}</p>
    {sale.createdAt && <p>结算时间 Checkout Time：{formatRetailAuditTimestamp(sale.createdAt)}</p>}<p className="retail-receipt-id">单号 Invoice No.：{sale.invoiceNumber ?? sale.id}</p>
    <table><colgroup><col className="retail-receipt-name" /><col className="retail-receipt-weight" /><col className="retail-receipt-price" /><col className="retail-receipt-amount" /></colgroup><thead><tr><th scope="col">鱼名 Fish</th><th scope="col">重量 Weight (kg)</th><th scope="col">单价 Unit Price (RM/kg)</th><th scope="col">金额 Amount (RM)</th></tr></thead><tbody>{sale.lines.map((line, index) => <tr key={index}><td>{line.chineseName}<small>{line.malayName}</small></td><td>{retailWeightKg(line)}</td><td>{(line.unitPriceCents / 100).toFixed(2)}</td><td>{(line.amountCents / 100).toFixed(2)}</td></tr>)}</tbody></table>
    <p className="retail-receipt-total">现金合计 Cash Total：<strong>{retailMoney(sale.totalAmountCents)}</strong></p>
    {sale.remark && <p>备注 Remark：{sale.remark}</p>}<p>内部 / 门市现金结算单 Internal Cash Invoice</p>
  </section>
}

type PreparedPdf = { sale: RetailSale; file: File; url?: string; handedOff: boolean }

export function RetailReceiptActions({ sale }: { sale: RetailSale }) {
  const [prepared, setPrepared] = useState<PreparedPdf | null>(null)
  const [generationError, setGenerationError] = useState(''), [actionError, setActionError] = useState('')
  const [notice, setNotice] = useState(''), [fallback, setFallback] = useState(false)
  const [sharing, setSharing] = useState(false), [retry, setRetry] = useState(0)
  const pdf = prepared?.sale === sale ? prepared : null

  useEffect(() => {
    let current = true, result: PreparedPdf | undefined
    setPrepared(null); setGenerationError(''); setActionError(''); setNotice(''); setFallback(false)
    // Finish all asynchronous work before the user clicks Share on Safari.
    void createRetailInvoicePdf(sale).then(file => {
      if (!current) return
      result = { sale, file, handedOff: false }
      setPrepared(result)
    }).catch(() => { if (current) setGenerationError('PDF 生成失败，请重试。 PDF generation failed. Please retry.') })
    return () => {
      current = false
      // An opened viewer/download may still need its URL after this invoice unmounts.
      // Handed-off URLs live until the browser unloads this document; never revoke them early.
      if (result?.url && !result.handedOff) URL.revokeObjectURL(result.url)
    }
  }, [sale, retry])

  function print() {
    setActionError(''); setNotice('')
    try {
      window.print()
      setNotice('已请求系统打印。如未出现打印界面，请在 Safari 中打开本页后重试。 Print requested. If no print dialog appears, open this page in Safari and retry.')
    } catch { setActionError('无法打开系统打印界面，请在 Safari 中重新打开本页后重试。 Unable to open the print dialog. Reopen this page in Safari and retry.') }
  }

  function showFallback(reason: string) {
    if (!pdf) return
    try {
      pdf.url ??= URL.createObjectURL(pdf.file)
      setFallback(true); setNotice(reason)
    } catch { setActionError('无法准备 PDF 打开或下载链接，请刷新页面后重试。 Unable to prepare PDF links. Refresh this page and retry.') }
  }

  async function share() {
    setActionError(''); setNotice('')
    if (!pdf) { setActionError('PDF 尚未准备好，请稍候重试。 PDF is not ready. Please wait and retry.'); return }
    if (sharing) return
    try {
      if (!navigator.share || !navigator.canShare || !navigator.canShare({ files: [pdf.file] })) {
        showFallback(window.isSecureContext === false ? '当前连接不支持文件分享，请使用 HTTPS，或打开 / 下载 PDF。 File sharing requires HTTPS. You can also open or download the PDF.' : '此浏览器不支持 PDF 文件分享，请打开或下载 PDF。 This browser cannot share PDF files. Please open or download the PDF.')
        return
      }
      // Invoke before the first await: the prepared File retains the direct click gesture.
      const request = navigator.share({ files: [pdf.file], title: `门市现金结算单 · ${sale.vendorName}` })
      setSharing(true)
      await request
    } catch (problem) {
      if (!(problem && typeof problem === 'object' && 'name' in problem && problem.name === 'AbortError')) {
        setActionError('PDF 分享失败，请重试，或使用打开 / 下载 PDF。 PDF sharing failed. Please retry, or open or download the PDF.')
        showFallback('可改用下方按钮打开或下载 PDF。 Use the buttons below to open or download the PDF.')
      }
    } finally { setSharing(false) }
  }

  function openPdf() {
    if (!pdf?.url) { setActionError('PDF 尚未准备好，请重试。 PDF is not ready. Please retry.'); return }
    setActionError('')
    try {
      // Open synchronously from this click; no async generation or popup print path.
      const viewer = window.open('', '_blank')
      if (!viewer) { setActionError('PDF 打开被浏览器拦截，请允许此网站弹出窗口，或使用下载 PDF。 The browser blocked the PDF window. Allow popups for this site, or download the PDF.'); return }
      viewer.opener = null
      viewer.location.replace(pdf.url)
      pdf.handedOff = true
      setNotice('已打开 PDF 预览。如新页面未显示内容，请返回并使用下载 PDF。 PDF preview opened. If the new page is blank, return here and download the PDF.')
    } catch { setActionError('无法打开 PDF，请使用下载 PDF，或在 Safari 中重试。 Unable to open the PDF. Download it, or retry in Safari.') }
  }

  return <div className="retail-no-print retail-output-actions">
    <div className="retail-actions"><button type="button" className="primary-action" onClick={print}>打印 Print</button>
      <button type="button" className="primary-action" disabled={!pdf || sharing} onClick={() => void share()}>PDF / 分享 PDF / Share</button></div>
    {!pdf && !generationError && <p role="status">正在准备 PDF… Preparing PDF…</p>}
    {sharing && <p role="status">正在分享 PDF… Sharing PDF…</p>}
    {generationError && <><p className="error" role="alert">{generationError}</p><button type="button" onClick={() => setRetry(value => value + 1)}>重新生成 PDF Regenerate PDF</button></>}
    {actionError && <p className="error" role="alert">{actionError}</p>}
    {notice && <p role="status">{notice}</p>}
    {pdf && !fallback && <button type="button" disabled={sharing} onClick={() => showFallback('可打开 PDF 预览或下载文件。 Open a PDF preview or download the file.')}>其他 PDF 选项 More PDF Options</button>}
    {fallback && pdf?.url && <div className="retail-pdf-fallback"><button type="button" onClick={openPdf}>打开 PDF Open PDF</button>
      <a href={pdf.url} download={pdf.file.name} onClick={() => { pdf.handedOff = true; setNotice('已请求下载 PDF，请查看浏览器下载列表。 PDF download requested. Check your browser downloads.') }}>下载 PDF Download PDF</a></div>}
  </div>
}
