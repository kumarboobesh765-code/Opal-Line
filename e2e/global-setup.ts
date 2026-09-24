import { request } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4198'
export const E2E_USER = process.env.E2E_USER ?? 'admin'
export const E2E_PASSWORD = process.env.E2E_PASSWORD ?? 'Opal@2026'

/**
 * Logs in once and stores the session cookies for every test. The backend
 * rate-limits /auth/login (20 req / 15 min / IP), so tests must NEVER log in
 * individually — reuse this state instead.
 */
export default async function globalSetup(): Promise<void> {
  const ctx = await request.newContext({ baseURL: BASE_URL })
  try {
    const res = await ctx.post('/api/v1/auth/login', { data: { username: E2E_USER, password: E2E_PASSWORD } })
    if (res.status() === 429) {
      throw new Error(
        `E2E login was rate-limited (HTTP 429). Wait 15 minutes for the auth rate limit to reset, then re-run.`,
      )
    }
    if (!res.ok()) {
      throw new Error(
        `E2E login failed (HTTP ${res.status()}). Is the installed app running on ${BASE_URL}? ` +
          `Credentials can be overridden with E2E_USER / E2E_PASSWORD.`,
      )
    }
    mkdirSync('e2e/.auth', { recursive: true })
    await ctx.storageState({ path: 'e2e/.auth/state.json' })
  } finally {
    await ctx.dispose()
  }
}
