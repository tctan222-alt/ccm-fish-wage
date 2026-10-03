import { createContext, useContext, useId, useLayoutEffect, useState } from 'react'

export const DirtyStateContext = createContext<{ dirty: boolean; register: (id: string, dirty: boolean) => void; remove: (id: string) => void } | null>(null)

// Only business forms opt in. Filters and navigation controls do not register.
export function useUnsavedChanges(dirty: boolean) {
  const context = useContext(DirtyStateContext)
  const id = useId()
  const register = context?.register, remove = context?.remove
  useLayoutEffect(() => { register?.(id, dirty) }, [register, id, dirty])
  useLayoutEffect(() => () => remove?.(id), [remove, id])
}

// For a form whose initial values are already loaded when it mounts.
export function useUnsavedForm(value: unknown) {
  const serialized = JSON.stringify(value)
  const [baseline, setBaseline] = useState(serialized)
  useUnsavedChanges(serialized !== baseline)
  return () => setBaseline(serialized)
}
