import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useUnsavedChanges } from './dirtyState'

function snapshot(form: HTMLFormElement) {
  return JSON.stringify(Array.from(form.querySelectorAll('input,select,textarea')).map(field => {
    if (field instanceof HTMLInputElement) return [field.value, field.checked]
    return (field as HTMLSelectElement | HTMLTextAreaElement).value
  }))
}

// Explicit opt-in for existing native business forms in frozen routes. The module
// stays unchanged; controls outside a form (including all list filters) are ignored.
export function BusinessFormGuard({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null), baselines = useRef(new WeakMap<HTMLFormElement, string>())
  const [dirty, setDirty] = useState(false)
  useUnsavedChanges(dirty)
  function check() {
    const forms = Array.from(root.current?.querySelectorAll('form') ?? [])
    let changed = false
    for (const form of forms) {
      const value = snapshot(form)
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
  return <div ref={root} onChangeCapture={check}>{children}</div>
}
