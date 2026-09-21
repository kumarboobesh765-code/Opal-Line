// WCAG 2.1 contrast audit for the theme tokens in frontend/src/index.css.
// Usage: node scripts/contrast-audit.mjs
import { readFileSync } from 'node:fs'

const css = readFileSync('frontend/src/index.css', 'utf8')

function parseBlock(name) {
  const m = css.match(new RegExp(`${name}\\s*{([\\s\\S]*?)}`, 'm'))
  if (!m) return null
  const vars = {}
  const re = /--([\w-]+):\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/g
  let mm
  while ((mm = re.exec(m[1]))) vars[mm[1]] = [Number(mm[2]), Number(mm[3]), Number(mm[4])]
  return vars
}

const light = parseBlock(':root')
const dark = parseBlock('\\.dark')
if (!light || !dark) { console.error('Could not parse theme blocks'); process.exit(1) }

function hslToRgb([h, s, l]) {
  s /= 100; l /= 100
  const k = (n) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [f(0) * 255, f(8) * 255, f(4) * 255]
}
function lum([r, g, b]) {
  const c = [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 })
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}
function ratio(fg, bg) {
  const L1 = lum(hslToRgb(fg)), L2 = lum(hslToRgb(bg))
  return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05)
}

// Pairs: [fg token, bg token, where used, required ratio]
const pairs = [
  ['foreground', 'background', 'Body text on page', 4.5],
  ['card-foreground', 'card', 'Text on cards', 4.5],
  ['muted-foreground', 'background', 'Secondary text', 4.5],
  ['muted-foreground', 'card', 'Secondary text on cards', 4.5],
  ['primary-foreground', 'primary', 'Text on primary buttons', 4.5],
  ['destructive-foreground', 'destructive', 'Text on danger buttons', 4.5],
  ['foreground', 'muted', 'Text on muted chips', 4.5],
  ['foreground', 'secondary', 'Text on secondary buttons', 4.5],
  ['accent-foreground', 'accent', 'Text on accent bg (active menu)', 4.5],
  ['success-700', 'success-50', 'Success badge text', 4.5],
  ['warning-700', 'warning-50', 'Warning badge text', 4.5],
  ['info-700', 'info-50', 'Info badge text', 4.5],
  ['primary-700', 'primary-50', 'Primary-tinted label on tinted bg', 4.5],
  ['primary-800', 'primary-50', 'Primary label on tinted bg (silver rate)', 4.5],
  ['sidebar-foreground', 'sidebar', 'Sidebar text', 4.5],
  ['sidebar-muted', 'sidebar', 'Sidebar secondary text', 4.5],
  ['sidebar-active-foreground', 'sidebar-active', 'Sidebar active item text', 4.5],
  ['input', 'card', 'Input border on card (interactive, 3:1)', 3],
  ['input', 'background', 'Input border on page (interactive, 3:1)', 3],
]

function audit(theme, label) {
  console.log(`\n=== ${label} ===`)
  let fails = 0
  for (const [fg, bg, use, req] of pairs) {
    if (!theme[fg] || !theme[bg]) { console.log(`  ??  ${fg} on ${bg} — token missing`); continue }
    const r = ratio(theme[fg], theme[bg])
    const pass = r >= req
    if (!pass) fails++
    console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${r.toFixed(2)}:1 (need ${req}:1)  ${fg} on ${bg} — ${use}`)
  }
  console.log(fails === 0 ? '  → All pairs pass ✓' : `  → ${fails} pair(s) FAIL`)
  return fails
}

const f = audit(light, 'LIGHT THEME')
const d = audit(dark, 'DARK THEME')
process.exit(f + d > 0 ? 1 : 0)
