import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { retailMoney, retailPriceCents, type RetailFish } from '../lib/retailSales'
import { quickAddRetailFish } from '../services/retailSales'

interface Props {
  fish: RetailFish[] | null
  query: string
  inputRef: RefObject<HTMLInputElement | null>
  onQueryChange: (query: string) => void
  onSelect: (fish: RetailFish) => void
  onCreated: (fish: RetailFish) => void
  onBusyChange: (busy: boolean) => void
}

export function RetailFishPicker({ fish, query, inputRef, onQueryChange, onSelect, onCreated, onBusyChange }: Props) {
  const [expanded, setExpanded] = useState(false), [highlighted, setHighlighted] = useState(-1)
  const [newName, setNewName] = useState<string | null>(null), [malay, setMalay] = useState(''), [price, setPrice] = useState('')
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const saving = useRef(false), composing = useRef(false), malayInput = useRef<HTMLInputElement>(null)
  const cleanQuery = query.trim(), keyword = cleanQuery.toLocaleLowerCase()
  const activeFish = fish?.filter(item => item.active) ?? []
  const matches = activeFish.filter(item => `${item.chineseName} ${item.malayName}`.toLocaleLowerCase().includes(keyword))
  const rank = (item: RetailFish) => {
    const names = [item.chineseName, item.malayName].map(name => name.toLocaleLowerCase())
    return names.includes(keyword) ? 0 : names.some(name => name.startsWith(keyword)) ? 1 : 2
  }
  const suggestions = matches.sort((a, b) => rank(a) - rank(b)).slice(0, 8)
  const activeIndex = Math.min(highlighted, suggestions.length - 1)
  const canCreate = fish !== null && !!cleanQuery && !activeFish.some(item => item.chineseName.toLocaleLowerCase() === keyword || item.malayName.toLocaleLowerCase() === keyword)
  const showSuggestions = expanded && newName === null && suggestions.length > 0
  useEffect(() => { if (newName !== null) malayInput.current?.focus(); else inputRef.current?.focus() }, [newName, inputRef])

  function select(item: RetailFish) { setExpanded(false); setHighlighted(-1); onSelect(item) }
  function startCreate() { setNewName(cleanQuery); setMalay(''); setPrice(''); setError(''); setExpanded(false) }
  function keyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing || composing.current || event.keyCode === 229) return
    if (event.key === 'Escape') { event.preventDefault(); setExpanded(false); setHighlighted(-1) }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); setExpanded(true)
      setHighlighted(current => !suggestions.length ? -1 : current < 0 ? (event.key === 'ArrowDown' ? 0 : suggestions.length - 1)
        : (current + (event.key === 'ArrowDown' ? 1 : suggestions.length - 1)) % suggestions.length)
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      if (expanded && suggestions.length) select(suggestions[activeIndex < 0 ? 0 : activeIndex])
      else if (canCreate) startCreate()
    }
  }
  async function create() {
    if (saving.current || newName === null) return
    setError('')
    try {
      if (!malay.trim()) throw new Error('请补齐新鱼的马来文名。 Enter the new fish Malay name.')
      const suggestedPriceCents = retailPriceCents(price)
      saving.current = true; setBusy(true); onBusyChange(true)
      const created = await quickAddRetailFish({ chineseName: newName, malayName: malay, suggestedPriceCents, active: true })
      setNewName(null); setMalay(''); setPrice(''); onCreated(created); select(created)
    } catch (problem) { setError(problem instanceof Error ? problem.message : '新增鱼种失败，请重试。 Could not add the fish. Please try again.') }
    finally { saving.current = false; setBusy(false); onBusyChange(false) }
  }
  // Keep inline suggestions in place until selection/clear/Escape. Collapsing
  // them on blur moves the controls below before a pointer click can finish.
  return <div className="retail-fish-picker">
    <label>鱼名 Fish<input ref={inputRef} role="combobox" autoComplete="off" maxLength={100}
      aria-autocomplete="list" aria-expanded={showSuggestions} aria-controls={showSuggestions ? 'retail-fish-suggestions' : undefined}
      aria-activedescendant={showSuggestions && activeIndex >= 0 ? `retail-fish-option-${activeIndex}` : undefined}
      placeholder="输入中文或马来文，也可直接新增 Enter Chinese or Malay, or add a new fish" value={query} disabled={newName !== null}
      onFocus={() => setExpanded(true)} onChange={event => { onQueryChange(event.target.value); setExpanded(true); setHighlighted(-1) }}
      onCompositionStart={() => { composing.current = true }} onCompositionEnd={() => { composing.current = false }} onKeyDown={keyDown} /></label>
    {fish === null ? <p role="status">正在载入鱼种… Loading fish…</p> : !fish.length ? <p className="notice">直接输入鱼名，即可在这里新增并开始销售。 Enter a fish name to add it and start selling.</p> : null}
    {showSuggestions && <div className="retail-fish-suggestions" id="retail-fish-suggestions" role="listbox" aria-label="鱼名建议 Fish Suggestions">
      {suggestions.map((item, index) => <button key={item.id} id={`retail-fish-option-${index}`} type="button" role="option" tabIndex={-1}
        aria-selected={index === activeIndex} onMouseDown={event => event.preventDefault()} onClick={() => select(item)}>
        <span><strong>{item.chineseName}</strong><small>{item.malayName || '未填马来文名 No Malay Name'}</small></span>
        <span>{item.suggestedPriceCents === null ? '未设建议价 No Suggested Price' : `${retailMoney(item.suggestedPriceCents)}/kg`}</span>
      </button>)}
    </div>}
    {newName === null && canCreate && <button type="button" className="retail-new-fish" onClick={startCreate}>新增 Add「{cleanQuery}」</button>}
    {newName !== null && <section className="retail-quick-add" aria-label="新增门市鱼种 Add Retail Fish"><h2>新增 Add「{newName}」</h2>
      <p>补齐后会保存为鱼种，并直接带入本次销售。 Save these details to add the fish and use it in this sale.</p>
      <form onSubmit={event => { event.preventDefault(); void create() }}><fieldset disabled={busy} className="retail-fields">
        <label>新鱼马来文名 New Fish Malay Name<input ref={malayInput} required maxLength={100} value={malay} onChange={event => setMalay(event.target.value)} /></label>
        <label>新鱼建议单价 New Fish Suggested Price (RM/kg)<input required inputMode="decimal" value={price} onChange={event => setPrice(event.target.value)} /></label>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="retail-actions"><button className="primary-action">{busy ? '正在新增… Adding fish…' : '保存并使用新鱼 Save and Use Fish'}</button>
          <button type="button" onClick={() => { setNewName(null); setError(''); setExpanded(true); inputRef.current?.focus() }}>取消新增 Cancel Add</button></div>
      </fieldset></form>
    </section>}
  </div>
}
