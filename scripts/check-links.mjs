// Cross-check frontend API calls vs backend endpoints.
// Usage: node scripts/check-links.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

// ---------- gather frontend API paths ----------
const frontFiles = []
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p)
    else if (/\.(tsx?|jsx?)$/.test(name) && !name.endsWith('.test.tsx')) frontFiles.push(p)
  }
}
walk(join(root, 'frontend', 'src'))

const pathRe = /['"`](\/(?:api\/v1\/)?[a-z][a-zA-Z0-9\-/_$:{}.$`"'()+?=&%]*?)['"`]/g
const frontPaths = new Map() // normalized path -> [file:line]
for (const f of frontFiles) {
  const src = readFileSync(f, 'utf8')
  const lines = src.split('\n')
  lines.forEach((line, i) => {
    // only lines that look like API calls to reduce noise
    if (!/request|requestRaw|fetch\(|\.get\(|\.post\(|\.patch\(|\.put\(|\.delete\(|apiUrl|API_BASE/.test(line)) return
    let m
    const re = new RegExp(pathRe.source, 'g')
    while ((m = re.exec(line))) {
      let p = m[1]
      if (!p.startsWith('/')) continue
      if (p.startsWith('/api/v1')) p = p.slice('/api/v1'.length)
      // skip pure frontend routes (login redirect) and obvious non-api
      if (p === '/login') continue
      if (!/^\/(db|accounts|auth|backup|settings|shopify|env-config|silver|loyalty|rbac|health|uploads)/.test(p)) continue
      // normalize ${...} -> :dyn, but ${suffix} query templates become ''
      const norm = p.replace(/\$\{suffix\}/g, '').replace(/\$\{[^}]*\}/g, ':dyn').replace(/\?.*$/, '')
      const key = norm
      if (!frontPaths.has(key)) frontPaths.set(key, [])
      frontPaths.get(key).push(`${f.replace(root + '/', '')}:${i + 1}`)
    }
  })
}

// ---------- gather backend endpoints ----------
const backFiles = []
walkBack(join(root, 'backend', 'src'))
function walkBack(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walkBack(p)
    else if (name.endsWith('.ts')) backFiles.push(p)
  }
}

// mounts: prefix -> file(s) that define routes under it
const mounts = []
// (prefix, file patterns)
mounts.push(['/db', join(root, 'backend', 'src', 'routes', 'dashboard.ts')])
mounts.push(['/db', join(root, 'backend', 'src', 'routes', 'db.ts')])
mounts.push(['/db', join(root, 'backend', 'src', 'routes', 'quotations.ts')])
mounts.push(['/accounts', join(root, 'backend', 'src', 'routes', 'accounting.ts')])
mounts.push(['/backup', join(root, 'backend', 'src', 'routes', 'backup.ts')])
mounts.push(['/rbac', join(root, 'backend', 'src', 'routes', 'rbac.ts')])
mounts.push(['/loyalty', join(root, 'backend', 'src', 'routes', 'loyalty.ts')])
mounts.push(['/env-config', join(root, 'backend', 'src', 'routes', 'envConfig.ts')])
mounts.push(['/auth', join(root, 'backend', 'src', 'routes', 'auth.ts')])
mounts.push(['/db', join(root, 'backend', 'src', 'notificationFeed.ts')])
mounts.push(['', join(root, 'backend', 'src', 'index.ts')])

const backRoutes = new Set() // normalized method-agnostic path
for (const [prefix, file] of mounts) {
  const src = readFileSync(file, 'utf8')
  const re = /\.(get|post|patch|put|delete|all)\(\s*['"`]([^'"`]+)['"`]/g
  let m
  while ((m = re.exec(src))) {
    let p = m[2]
    if (p === '/') p = ''
    const full = prefix + p
    backRoutes.add(full)
  }
  // also app.get('/api/v1/...') direct style
  const re2 = /app\.(get|post|patch|put|delete|all)\(\s*['"`]\/api\/v1([^'"`]+)['"`]/g
  while ((m = re2.exec(src))) {
    backRoutes.add(m[2])
  }
}

// ---------- match ----------
function routeMatches(frontPath, backPath) {
  const fSeg = frontPath.split('/').filter(Boolean)
  const bSeg = backPath.split('/').filter(Boolean)
  if (fSeg.length !== bSeg.length) return false
  for (let i = 0; i < fSeg.length; i++) {
    const f = fSeg[i], b = bSeg[i]
    if (b.startsWith(':')) continue
    if (f === ':dyn' && b) continue
    if (f !== b) return false
  }
  return true
}

const broken = []
for (const [p, locs] of [...frontPaths].sort()) {
  if (p === '/health') continue
  const hit = [...backRoutes].some((b) => routeMatches(p, b))
  if (!hit) broken.push({ path: p, locs })
}

console.log(`Frontend API paths checked: ${frontPaths.size}`)
console.log(`Backend routes collected:   ${backRoutes.size}`)
console.log('')
if (broken.length === 0) {
  console.log('✅ All frontend API calls match a backend route.')
} else {
  console.log(`❌ BROKEN API LINKS: ${broken.length}`)
  for (const b of broken) {
    console.log(`  ${b.path}`)
    for (const l of b.locs.slice(0, 3)) console.log(`     at ${l}`)
  }
}
