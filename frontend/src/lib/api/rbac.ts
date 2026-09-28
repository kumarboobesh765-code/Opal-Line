import type {
  Permissions,
  RbacModule,
  Role,
  UserPermissions,
} from '@/types'
import { request } from './core'

export const rbacApi = {
  getModules: () => request<RbacModule[]>('/rbac/modules'),
  getRoles: () => request<Role[]>('/rbac/roles'),
  createRole: (body: { name: string; description?: string; permissions: Permissions }) =>
    request<Role>('/rbac/roles', { method: 'POST', body: JSON.stringify(body) }),
  updateRole: (id: string, body: Partial<{ name: string; description: string; permissions: Permissions }>) =>
    request<Role>(`/rbac/roles/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  removeRole: (id: string) => request<{ ok: boolean }>(`/rbac/roles/${id}`, { method: 'DELETE' }),
  getUserPermissions: (userId: string) => request<UserPermissions>(`/rbac/users/${userId}/permissions`),
  setUserPermissions: (userId: string, permissions: Permissions | null) =>
    request<UserPermissions>(`/rbac/users/${userId}/permissions`, {
      method: 'PUT',
      body: JSON.stringify({ permissions }),
    }),
}
