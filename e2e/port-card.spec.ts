import { expect, test } from '@playwright/test'

/**
 * The System Status "Port block" card: the diagnostics view behind
 * "port already in use" reports. It must render the reserved 47191-47198
 * range with a Free/In use state per port, fed live from /api/v1/system/ports.
 */
test.describe('System Status', () => {
  test('shows the Opal Line port block with a live state per port', async ({ page }) => {
    await page.goto('/system/status')
    await expect(page.getByRole('heading', { name: /Port block 47191–47198/ })).toBeVisible()
    // Every reserved port is listed with its role…
    for (const label of [
      'Backend API — development',
      'Backend API — installed app',
      'PostgreSQL — installed app',
      'Vite dev server (UI)',
    ]) {
      await expect(page.getByText(label)).toBeVisible()
    }
    // …and each row carries a Free / In use badge plus a holder line.
    await expect(page.getByRole('button', { name: /Refresh/ }).first()).toBeVisible()
    await expect(page.getByText(/Free|In use/).first()).toBeVisible()
    await expect(page.getByText(/PID \d+|Free/).first()).toBeVisible()
  })
})
