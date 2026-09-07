import { useEffect } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/auth/auth-context'

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { currentUser, loading } = useAuth()
  const location = useLocation()

  useEffect(() => {
    if (!loading && !currentUser) {
      window.scrollTo({ top: 0 })
    }
  }, [loading, currentUser])

  if (loading) {
    return (
      <div className="flex h-full min-h-[60vh] items-center justify-center text-sm text-muted-foreground">
        Loading workspace...
      </div>
    )
  }
  if (!currentUser) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }
  return <>{children}</>
}

export function RequireModule({ module, children }: { module: string; children: React.ReactNode }) {
  const { hasPermission } = useAuth()
  if (!hasPermission(module, 'view')) {
    return <Navigate to="/" replace />
  }
  return <>{children}</>
}
