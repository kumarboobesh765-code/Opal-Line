import { useCallback, useEffect, useState } from 'react'
import { ApiError, shopifyApi } from './api'
import type { SyncResource } from '@/types/shopify'

export interface SyncResourceResult<T> {
  data: T[]
  syncedAt: string | null
  loading: boolean
  syncing: boolean
  error: string | null
  configured: boolean
  load: (silent?: boolean) => Promise<void>
  syncNow: () => Promise<void>
}

export function useShopifyResource<T>(
  resource: SyncResource,
  loader: () => Promise<{ syncedAt: string | null; data: T[] }>,
): SyncResourceResult<T> {
  const [data, setData] = useState<T[]>([])
  const [syncedAt, setSyncedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [configured, setConfigured] = useState(true)

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true)
      setError(null)
      try {
        const result = await loader()
        setData(result.data)
        setSyncedAt(result.syncedAt)
        setConfigured(true)
      } catch (err) {
        if (err instanceof ApiError && err.status === 503) setConfigured(false)
        else setError(err instanceof Error ? err.message : 'Could not reach the backend server')
      } finally {
        setLoading(false)
      }
    },
    [loader],
  )

  const syncNow = useCallback(async () => {
    setSyncing(true)
    setError(null)
    try {
      await shopifyApi.sync([resource])
      await load(true)
    } catch (err) {
      if (err instanceof ApiError && err.status === 503) setConfigured(false)
      else setError(err instanceof Error ? err.message : 'Sync failed')
    } finally {
      setSyncing(false)
    }
  }, [resource, load])

  useEffect(() => {
    load()
  }, [load])

  return { data, syncedAt, loading, syncing, error, configured, load, syncNow }
}
