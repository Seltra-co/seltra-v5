//seltra-web/frontend/context/StoreContext.tsx
'use client'
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { StoreData } from '@/components/storefront/StorefrontPreview'

const KEY = 'seltra:active_store'

type Ctx = { activeStore: StoreData | null; setActiveStore: (s: StoreData | null) => void }

const StoreContext = createContext<Ctx | undefined>(undefined)

function read(): StoreData | null {
  if (typeof window === 'undefined') return null
  try { const r = localStorage.getItem(KEY); return r ? JSON.parse(r) : null } catch { return null }
}

export function StoreProvider({ children }: { children: ReactNode }) {
  // Keep the server and first browser render identical. The persisted store
  // is restored after hydration so pages don't render different business
  // copy (or project state) on the two sides of the boundary.
  const [store, setStoreState] = useState<StoreData | null>(null)
  useEffect(() => { setStoreState(read()) }, [])
  const value = useMemo<Ctx>(() => ({
    activeStore: store,
    setActiveStore: (s) => {
      setStoreState(s)
      if (typeof window !== 'undefined') { if (s) localStorage.setItem(KEY, JSON.stringify(s)); else localStorage.removeItem(KEY) }
    },
  }), [store])
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useStore() {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore must be used within StoreProvider')
  return ctx
}
