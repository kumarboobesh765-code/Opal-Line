import { expect, test } from '@playwright/test'

test.describe('sales order details dialog', () => {
  test('order details always show the customer name and contact rows', async ({ page }) => {
    test.setTimeout(60_000)
    await page.goto('/sales/orders')
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({ timeout: 20000 })

    // Every test in this suite opens an existing order. On a freshly
    // bootstrapped database (installed desktop app, CI) the table only shows
    // its empty-state row — skip instead of failing on a missing action.
    const orderRows = page.locator('table tbody tr', { has: page.getByRole('button', { name: /view order/i }) })
    if ((await orderRows.count()) === 0) {
      test.skip(true, 'no sales orders in this database (fresh install)')
      return
    }

    // Open the details dialog from the first row's "View order" action.
    await page.getByRole('button', { name: /view order/i }).first().click({ timeout: 20000 })

    const dialog = page.getByRole('dialog')
    // The dialog must always identify WHO placed the order — this was the
    // regression: the customer name row was missing entirely.
    const customerRow = dialog.getByText('Customer', { exact: true }).locator('..')
    await expect(customerRow).toBeVisible({ timeout: 10000 })
    const customerValue = (await customerRow.innerText()).replace(/^Customer/, '').trim()
    expect(customerValue.length, 'customer name must not be blank').toBeGreaterThan(0)
    test.info().annotations.push({ type: 'note', description: `customer shown: ${customerValue}` })

    // Core detail rows must render too.
    await expect(dialog.getByText('Order Value', { exact: true })).toBeVisible()
    await expect(dialog.getByText('Payment', { exact: true })).toBeVisible()
    // Regression guard: the phone used to render twice (contact row + flat
    // address row). It must appear exactly once as a labelled row now.
    await expect(dialog.getByText('Phone', { exact: true })).toHaveCount(1)
  })

  test('repaired orders show addresses and email in the dialog', async ({ page }) => {
    test.setTimeout(60_000)
    await page.goto('/sales/orders')
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({ timeout: 20000 })

    // Find the row for a PII-recovered order (Kavya Reddy, order #1030 on the
    // dev store) and open its dialog. The repaired row is dev-store data —
    // skip on installations whose database doesn't contain it (e.g. the
    // desktop app with a fresh seeded database).
    const row = page.locator('table tbody tr', { hasText: 'Kavya Reddy' }).first()
    if ((await row.count()) === 0) {
      test.skip(true, 'repaired demo order (Kavya Reddy) not present in this database')
      return
    }
    await row.getByRole('button', { name: /view order/i }).click({ timeout: 20000 })

    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText('Customer', { exact: true })).toBeVisible()
    await expect(dialog.getByText('Kavya Reddy').first()).toBeVisible()
    // Email comes from the order row (or the matched customer record).
    await expect(dialog.getByText('kavya.reddy@gmail.com')).toBeVisible()
    // Address block from the recovered billing/shipping jsonb.
    await expect(dialog.getByText('Billing Address').or(dialog.getByText('Shipping Address')).first()).toBeVisible({ timeout: 10000 })
  })

  test('dialog is responsive: fits desktop and mobile viewports with footer visible', async ({ page }) => {
    test.setTimeout(60_000)

    const openDialog = async () => {
      await page.goto('/sales/orders')
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({ timeout: 20000 })
      // The table renders an empty-state row when there are no orders —
      // look for rows that actually carry a "View order" action.
      if ((await page.locator('table tbody tr', { has: page.getByRole('button', { name: /view order/i }) }).count()) === 0) {
        test.skip(true, 'no sales orders in this database (fresh install)')
      }
      await page.getByRole('button', { name: /view order/i }).first().click({ timeout: 20000 })
      const d = page.getByRole('dialog')
      await expect(d.getByText('Customer', { exact: true })).toBeVisible({ timeout: 10000 })
      return d
    }

    for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport)
      const dialog = await openDialog()
      await page.waitForTimeout(250)

      const geo = await dialog.evaluate((el) => {
        const r = el.getBoundingClientRect()
        const body = el.querySelector('.overflow-y-auto')
        const footer = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Packing Slip'))
        if (body) body.scrollTo(0, body.scrollHeight)
        return {
          fitsV: r.height <= window.innerHeight,
          fitsH: r.width <= window.innerWidth,
          footerVisible: footer ? footer.getBoundingClientRect().bottom <= window.innerHeight : null,
        }
      })
      expect(geo.fitsV, `dialog fits vertically at ${viewport.width}px`).toBe(true)
      expect(geo.fitsH, `dialog fits horizontally at ${viewport.width}px`).toBe(true)
      expect(geo.footerVisible, `action footer visible after scroll at ${viewport.width}px`).toBe(true)
      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 5000 })
    }
  })

  test('every order row opens a dialog without errors', async ({ page }) => {
    test.setTimeout(120_000)
    const pageErrors: string[] = []
    page.on('pageerror', (e) => pageErrors.push(String(e)))

    await page.goto('/sales/orders')
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({ timeout: 20000 })

    const rows = page.locator('table tbody tr', { has: page.getByRole('button', { name: /view order/i }) })
    if ((await rows.count()) === 0) {
      test.skip(true, 'no sales orders in this database (fresh install)')
      return
    }
    const count = await rows.count()
    test.info().annotations.push({ type: 'note', description: `${count} order rows` })

    // Walk up to the first 8 rows: open the dialog, assert it renders, close.
    for (let i = 0; i < Math.min(count, 8); i++) {
      await rows.nth(i).getByRole('button', { name: /view order/i }).click()
      await expect(page.getByRole('dialog').getByText('Customer', { exact: true })).toBeVisible({ timeout: 10000 })
      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 5000 })
    }
    expect(pageErrors, 'uncaught exceptions while opening order dialogs').toEqual([])
  })
})
