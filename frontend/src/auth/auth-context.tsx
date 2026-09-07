import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { authApi, dbApi, rbacApi, resetCsrfToken } from '@/lib/api'
import { can } from '@/lib/permissions'
import type { ModulePermission, Permissions, User, UserPermissions } from '@/types'

interface AuthContextValue {
  currentUser: User | null
  permissions: Permissions
  permissionsMeta: UserPermissions | null
  users: User[]
  loading: boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => void
  hasPermission: (moduleKey: string, action: keyof ModulePermission) => boolean
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [currentUser, setCurrentUser] = useState<User | null>(null)
  const [permissions, setPermissions] = useState<Permissions>({})
  const [permissionsMeta, setPermissionsMeta] = useState<UserPermissions | null>(null)
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const me = await authApi.getMe()
      const [allUsers, meta] = await Promise.all([
        dbApi.getUsers().catch((err) => { console.warn('Failed to load users:', err); return [] as User[] }),
        rbacApi.getUserPermissions(me.id).catch((err) => { console.warn('Failed to load permissions:', err); return null }),
      ])
      setUsers(allUsers)
      setCurrentUser(me)
      setPermissionsMeta(meta)
      if (meta?.effective) {
        setPermissions(meta.effective)
      } else if (me.role === 'Super Admin') {
        setPermissions({ '*': { view: true, create: true, edit: true, delete: true } })
      } else {
        setPermissions(meta?.effective ?? {})
      }
    } catch {
      setCurrentUser(null)
      setPermissions({})
      setPermissionsMeta(null)
    }
  }, [])

  const login = useCallback(
    async (username: string, password: string) => {
      await authApi.login(username, password)
      await load()
    },
    [load],
  )

  const logout = useCallback(async () => {
    await authApi.logout().catch(() => {})
    resetCsrfToken()
    setCurrentUser(null)
    setPermissions({})
    setPermissionsMeta(null)
  }, [])

  const refresh = useCallback(async () => {
    await load()
  }, [load])

  useEffect(() => {
    load()
      .catch(() => logout())
      .finally(() => setLoading(false))
  }, [load, logout])

  const hasPermission = useCallback(
    (moduleKey: string, action: keyof ModulePermission) => can(permissions, moduleKey, action),
    [permissions],
  )

  const value = useMemo(
    () => ({ currentUser, permissions, permissionsMeta, users, loading, login, logout, hasPermission, refresh }),
    [currentUser, permissions, permissionsMeta, users, loading, login, logout, hasPermission, refresh],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}