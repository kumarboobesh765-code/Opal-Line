import { expect, test } from '@playwright/test'
import { E2E_PASSWORD, E2E_USER } from './global-setup'

/**
 * Login flow tests. Negative tests deliberately use throwaway usernames so the
 * real admin account is never locked out (5 failures / 15 minutes).
 */
test.describe('login flow', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test('valid credentials land on the dashboard', async ({ page }) => {
    await page.goto('/login')
    await page.locator('#username').fill(E2E_USER)
    await page.locator('#password').fill(E2E_PASSWORD)
    await page.getByRole('button', { name: /sign in/i }).click()
    await page.waitForURL('**/')
    await expect(page).not.toHaveURL(/\/login/)
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
    // A fresh login may revoke earlier sessions for this user, so re-save the
    // shared storage state — every later test reads it from disk.
    await page.context().storageState({ path: 'e2e/.auth/state.json' })
  })

  test('invalid credentials show an error and stay on the login page', async ({ page }) => {
    await page.goto('/login')
    await page.locator('#username').fill(`e2e-ui-probe-${Date.now()}`)
    await page.locator('#password').fill('wrong-password')
    await page.getByRole('button', { name: /sign in/i }).click()
    await expect(page.getByText('Invalid username or password')).toBeVisible()
    await expect(page).toHaveURL(/\/login/)
  })

  test('login form is protected by a content security policy', async ({ page }) => {
    const res = await page.goto('/login')
    const csp = res?.headers()['content-security-policy'] ?? ''
    expect(csp).toContain("default-src 'self'")
  })
})

test.describe('authenticated session', () => {
  test('the session survives a page reload', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
    await page.reload()
    await expect(page).not.toHaveURL(/\/login/)
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
  })

  test('API session works for authenticated XHR from the UI origin', async ({ page }) => {
    await page.goto('/')
    const result = await page.evaluate(async () => {
      const res = await fetch('/api/v1/auth/me', { credentials: 'include' })
      return { status: res.status, ok: res.ok }
    })
    expect(result.status).toBe(200)
    expect(result.ok).toBe(true)
  })
})
