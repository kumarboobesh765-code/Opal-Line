import { createContext, useContext } from 'react'
import type { SilverRate } from '@/types'

export interface SilverRateContextValue {
  rate: SilverRate | null
  refresh: () => Promise<void>
}

export const SilverRateContext = createContext<SilverRateContextValue | null>(null)

export function useSilverRate() {
  const ctx = useContext(SilverRateContext)
  if (!ctx) throw new Error('useSilverRate must be used within a SilverRateProvider')
  return ctx
}
