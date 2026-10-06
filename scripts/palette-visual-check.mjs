// Measures the navy+gold palette as the browser actually computes it, in both
// light and dark mode. Token values in source are not proof the cascade
// applied them.
// Run: node scripts/palette-visual-check.mjs
import { chromium } from '@playwright/test'

const BASE = process.env.PALETTE_BASE_URL ?? 'http://127.0.0.1:47195'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

let failures = 0
function check(label, actual, expected) {
  const ok = actual === expected
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(26)} ${actual}${ok ? '' : `  (expected ${expected})`}`)
}

for (const scheme of ['light', 'dark']) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.evaluate((s) => document.documentElement.classList.toggle('dark', s === 'dark'), scheme)
  await page.waitForTimeout(300)

  console.log(`\n── ${scheme.toUpperCase()} (computed) ──`)
  const read = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement)
    const v = (n) => root.getPropertyValue(n).trim()
    const body = getComputedStyle(document.body)
    return {
      background: body.backgroundColor,
      foreground: body.color,
      sidebar: v('--sidebar'),
      primary: v('--primary'),
      gold: v('--gold'),
      sidebarActive: v('--sidebar-active'),
    }
  })

  console.log(`  body background      ${read.background}`)
  console.log(`  body color           ${read.foreground}`)
  console.log(`  --sidebar            ${read.sidebar}`)
  console.log(`  --primary            ${read.primary}`)
  console.log(`  --gold               ${read.gold}`)
  console.log(`  --sidebar-active     ${read.sidebarActive}`)

  // Navy means blue-dominant and dark; gold means warm and light.
  const navy = read.sidebar.match(/(\d+)\s+(\d+)%\s+(\d+)%/)
  if (navy) {
    const [, h, s, l] = navy.map(Number)
    check('sidebar is navy (hue 200-240)', h >= 200 && h <= 240, true)
    check('sidebar is dark (L < 25)', l < 25, true)
  } else { failures++ }

  const gold = read.gold.match(/(\d+)\s+(\d+)%\s+(\d+)%/)
  if (gold) {
    const [, h, s, l] = gold.map(Number)
    check('gold is warm (hue 30-55)', h >= 30 && h <= 55, true)
    check('gold is saturated (S > 55)', s > 55, true)
    check('gold is light (L > 40)', l > 40, true)
  } else { failures++ }

  // No purple may survive anywhere.
  const purple = await page.evaluate(() => document.documentElement.outerHTML.match(/262\s+\d+%/g)?.length ?? 0)
  check('no purple HSL left', purple, 0)
}

await page.screenshot({ path: 'palette-dark.png', fullPage: false })
await browser.close()
console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`)
process.exit(failures === 0 ? 0 : 1)