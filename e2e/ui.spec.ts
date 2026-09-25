import { expect, test } from '@playwright/test'

/**
 * Walks the main application pages and fails on uncaught exceptions, React
 * error boundaries, or a "Page not found" render — the three ways a page
 * breakage surfaces in this SPA.
 */
const PAGES = [
  '/',
  '/system/status',
  '/system/updates',
  '/system/users',
  '/system/backup',
  '/system/settings',
  '/system/connections',
  '/system/activity',
  '/inventory/products',
  '/sales/invoices',
  '/reports/business',
  '/shopify/dashboard',
  '/accounts/accounting',
]

for (const path of PAGES) {
  test(`renders ${path} without errors`, async ({ page }) => {
    const pageErrors: string[] = []
    const consoleErrors: string[] = []
    page.on('pageerror', (e) => pageErrors.push(String(e)))
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text())
    })

    await page.goto(path)
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({ timeout: 20000 })
    await expect(page.getByText('Page not found')).toHaveCount(0)
    await expect(page.getByText('An error occurred')).toHaveCount(0)

    expect(pageErrors, `uncaught exceptions on ${path}`).toEqual([])
    expect(
      consoleErrors.filter((e) => !/favicon|net::ERR_ABORTED|Load failed/i.test(e)),
      `console errors on ${path}`,
    ).toEqual([])
  })
}

test('system status page shows live server info, updates and logs', async ({ page }) => {
  await page.goto('/system/status')
  await expect(page.getByRole('heading', { name: 'System Status' })).toBeVisible()
  // live data from the new /api/v1/system/status endpoint
  await expect(page.getByText('Port 47192')).toBeVisible({ timeout: 15000 })
  await expect(page.getByText('Healthy')).toBeVisible()
  // update card (desktop bridge may be absent in a plain browser — the card
  // must render either way)
  await expect(page.getByRole('heading', { name: 'Software updates' })).toBeVisible()
  // log viewer wired to /api/v1/system/logs
  await expect(page.getByRole('heading', { name: 'Server logs' })).toBeVisible()
  await expect(page.getByRole('button', { name: /app\.log/ })).toBeVisible()
})

test('navigation sidebar exposes the system section', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('link', { name: /System Status/i })).toBeVisible()
  await expect(page.getByRole('link', { name: /Users & Roles/i })).toBeVisible()
  await expect(page.getByRole('link', { name: /Backup & Restore/i })).toBeVisible()
})
