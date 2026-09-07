import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { dbApi } from '@/lib/api'
import type { SilverRate } from '@/types'

interface SilverRateContextValue {
  rate: SilverRate | null
  refresh: () => Promise<void>
}

const SilverRateContext = createContext<SilverRateContextValue | null>(null)

const POLL_INTERVAL_MS = 30_000

export function SilverRateProvider({ children }: { children: React.ReactNode }) {
  const [rate, setRate] = useState<SilverRate | null>(null)
  const mounted = useRef(true)

  const refresh = useCallback(async () => {
    try {
      const r = await dbApi.getSilverRate()
      if (mounted.current) setRate(r)
    } catch {
      // keep last known rate on transient errors
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    refresh()
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') refresh()
    }, POLL_INTERVAL_MS)
    return () => {
      mounted.current = false
      window.clearInterval(interval)
    }
  }, [refresh])

  const value = useMemo(() => ({ rate, refresh }), [rate, refresh])

  return <SilverRateContext.Provider value={value}>{children}</SilverRateContext.Provider>
}

export function useSilverRate() {
  const ctx = useContext(SilverRateContext)
  if (!ctx) throw new Error('useSilverRate must be used within a SilverRateProvider')
  return ctx
}
