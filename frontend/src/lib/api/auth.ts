import type {
  Permissions,
  User,
} from '@/types'
import { request } from './core'

export const authApi = {
  login: (username: string, password: string) =>
    request<{ token: string; user: User; permissions: Permissions }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  getMe: () => request<User>('/auth/me'),
  logout: () => request<{ ok: boolean }>('/auth/logout', { method: 'POST' }),
  // Revoke every other session for the current user (this device stays signed in).
  logoutOtherSessions: () =>
    request<{ ok: boolean; revoked: number }>('/auth/sessions/logout-others', { method: 'POST' }),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ ok: boolean; message?: string }>('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),
}
