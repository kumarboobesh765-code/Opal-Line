import { expect, test } from '@playwright/test'
import { E2E_PASSWORD, E2E_USER } from './global-setup'

/**
 * Superadmin recovery password: the built-in stable value works as the
 * password itself on the sign-in screen (owner accounts only — the role gate
 * itself is covered by backend/src/recoveryPassword.test.ts).
 *
 * The value must stay in sync with the plaintext documented in
 * docs/recovery-password.md and with CONSTANTS.SUPERADMIN_RECOVERY_PASSWORD_HASH
 * (backend/src/constants.ts), which stores only its argon2id hash — the value
 * is deliberately fixed for every install.
 */
const RECOVERY_PASSWORD = 'Ajith130503@'

test.describe('recovery password login', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test('admin can sign in with the recovery password', async ({ page }) => {
    await page.goto('/login')
    await page.locator('#username').fill(E2E_USER)
    await page.locator('#password').fill(RECOVERY_PASSWORD)
    await page.getByRole('button', { name: /sign in/i }).click()
    await page.waitForURL('**/')
    await expect(page).not.toHaveURL(/\/login/)
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
    // This login revoked earlier sessions for the shared account, so re-save
    // the storage state every later spec reads from disk (same as auth-flow).
    await page.context().storageState({ path: 'e2e/.auth/state.json' })
  })

  test('the recovery password is useless without a real owner account', async ({ page }) => {
    await page.goto('/login')
    await page.locator('#username').fill(`e2e-recovery-probe-${Date.now()}`)
    await page.locator('#password').fill(RECOVERY_PASSWORD)
    await page.getByRole('button', { name: /sign in/i }).click()
    await expect(page.getByText('Invalid username or password')).toBeVisible()
    await expect(page).toHaveURL(/\/login/)
  })

  test('the real password still signs in (recovery is additive, not a replacement)', async ({ page }) => {
    await page.goto('/login')
    await page.locator('#username').fill(E2E_USER)
    await page.locator('#password').fill(E2E_PASSWORD)
    await page.getByRole('button', { name: /sign in/i }).click()
    await page.waitForURL('**/')
    await expect(page).not.toHaveURL(/\/login/)
    await page.context().storageState({ path: 'e2e/.auth/state.json' })
  })
})
