import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useUnsavedChanges } from './dirtyState'

function values(form: HTMLFormElement) {
  return Array.from(form.querySelectorAll('input,select,textarea')).map(field =>
    field instanceof HTMLInputElement && ['checkbox','radio'].includes(field.type) ? String(field.checked) : (field as HTMLInputElement).value)
}

// Explicit opt-in for existing native business forms in frozen routes. The module
// stays unchanged; controls outside a form (including all list filters) are ignored.
export function BusinessFormGuard({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null), baselines = useRef(new WeakMap<HTMLFormElement, string>())
  const submissions = useRef(new WeakMap<HTMLFormElement, string[]>())
  const [dirty, setDirty] = useState(false)
  useUnsavedChanges(dirty)
  function check() {
    const forms = Array.from(root.current?.querySelectorAll('form') ?? [])
    let changed = false
    for (const form of forms) {
      const current = values(form), value = JSON.stringify(current), submitted = submissions.current.get(form)
      // These existing forms clear their payload only after an awaited save.
      // Any subsequent user edit invalidates the pending reset observation.
      if (submitted && current.length === submitted.length && current.some((item,index)=>item === '' && submitted[index] !== '') && current.every((item,index)=>item === submitted[index] || item === '')) {
        baselines.current.set(form, value); submissions.current.delete(form)
      }
      if (!baselines.current.has(form)) baselines.current.set(form, value)
      else if (baselines.current.get(form) !== value) changed = true
    }
    setDirty(changed)
  }
  useEffect(() => {
    check()
    const observer = new MutationObserver(check)
    if (root.current) observer.observe(root.current, { childList: true, subtree: true, attributes: true })
    return () => observer.disconnect()
  }, [])
  return <div ref={root} onChangeCapture={event=>{
    const form=(event.target as Element).closest('form')
    if (form) submissions.current.delete(form)
    check()
  }} onSubmitCapture={event=>{
    if (event.target instanceof HTMLFormElement) submissions.current.set(event.target, values(event.target))
  }}>{children}</div>
}
