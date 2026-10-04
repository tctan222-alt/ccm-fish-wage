import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { DirtyStateContext } from './dirtyState'

export function DirtyStateProvider({ children }: { children: ReactNode }) {
  const [forms, setForms] = useState<Record<string, boolean>>({})
  const register = useCallback((id: string, dirty: boolean) => setForms(current => current[id] === dirty ? current : { ...current, [id]: dirty }), [])
  const remove = useCallback((id: string) => setForms(current => {
    if (!(id in current)) return current
    const next = { ...current }; delete next[id]; return next
  }), [])
  const value = useMemo(() => ({ dirty: Object.values(forms).some(Boolean), register, remove }), [forms, register, remove])
  return <DirtyStateContext.Provider value={value}>{children}</DirtyStateContext.Provider>
}
