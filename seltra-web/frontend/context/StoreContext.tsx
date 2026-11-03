//seltra-web/frontend/context/StoreContext.tsx
'use client'
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import type { StoreData } from '@/components/storefront/StorefrontPreview'

const KEY = 'seltra:active_store'

type Ctx = { activeStore: StoreData | null; setActiveStore: (s: StoreData | null) => void }

const StoreContext = createContext<Ctx | undefined>(undefined)

export function StoreProvider({ children }: { children: ReactNode }) {
  // A persisted store is only a selection hint. It must be revalidated against
  // the signed-in user's store list before components use it for tenant APIs.
  // Restoring it here caused requests to run against a previous account or
  // database before the dashboard could reconcile ownership.
  const [store, setStoreState] = useState<StoreData | null>(null)
  const setActiveStore = useCallback((s: StoreData | null) => {
    setStoreState(s)
    if (typeof window !== 'undefined') {
      if (s) localStorage.setItem(KEY, JSON.stringify(s))
      else localStorage.removeItem(KEY)
    }
  }, [])
  const value = useMemo<Ctx>(() => ({
    activeStore: store,
    setActiveStore,
  }), [store, setActiveStore])
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useStore() {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore must be used within StoreProvider')
  return ctx
}
