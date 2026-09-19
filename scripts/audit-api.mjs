/**
 * API contract audit — extracts every path the frontend calls and checks it
 * against the backend's registered routes. Run: node scripts/audit-api.mjs
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const FE = 'frontend/src'
const BE = 'backend/src'

// ── 1. Collect frontend API paths ───────────────────────────────────────────
function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p)
  }
  return out
}

const feFiles = walk(FE)
const called = new Map() // path -> [file:line]

for (const f of feFiles) {
  const src = readFileSync(f, 'utf8')
  const lines = src.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const patterns = [
      /request(?:<[^>]*>)?\(\s*[`'"](\/[^`'"?]+)/g,
      /(?:get|post|put|patch|del|remove)\s*[:(]\s*[`'"](\/[^`'"?]+)/g,
    ]
    for (const re of patterns) {
      let m
      while ((m = re.exec(line)) !== null) {
        const p = m[1].replace(/\$\{[^}]+\}/g, ':x')
        const key = p.split('?')[0]
        if (!called.has(key)) called.set(key, [])
        called.get(key).push(`${f}:${i + 1}`)
      }
    }
  }
}

// ── 2. Collect backend registered routes ────────────────────────────────────
const beFiles = walk(BE)
const registered = new Set()
const routerMounts = new Map() // router var name -> [mount prefixes]

for (const f of beFiles) {
  const src = readFileSync(f, 'utf8')
  // app.use('/api/v1/xyz', requireAuth, enforceRbac, backupRouter) — take the
  // LAST identifier in the arg list (the actual router), plus any *Router names
  for (const m of src.matchAll(/app\.use\(\s*['"](\/[^'"]*)['"]\s*,\s*([^)]+)\)/g)) {
    const prefix = m[1]
    const idents = [...m[2].matchAll(/([A-Za-z_$][\w$]*)/g)].map((x) => x[1])
    const routers = idents.filter((i) => /Router$|router$/.test(i))
    const chosen = routers.length ? routers : [idents[idents.length - 1]]
    for (const r of chosen) {
      const list = routerMounts.get(r) ?? []
      if (!list.includes(prefix)) list.push(prefix)
      routerMounts.set(r, list)
    }
  }
}

for (const f of beFiles) {
  const src = readFileSync(f, 'utf8')
  // router-level routes with their variable name: xxxRouter.get('/path'
  for (const m of src.matchAll(/\b([A-Za-z_$][\w$]*)\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/g)) {
    const prefixes = routerMounts.get(m[1]) ?? ['']
    for (const prefix of prefixes) registered.add(`${prefix}${m[3]}`)
  }
  // direct app.get/post style
  for (const m of src.matchAll(/\bapp\.(get|post|put|patch|delete)\(\s*['"`](\/[^'"`]+)['"`]/g)) {
    registered.add(m[2])
  }
}

// ── 3. Match frontend calls to backend routes ───────────────────────────────
function normalize(p) {
  return (p.replace('/api/v1', '').replace(/\/$/, '') || '/')
}

const bePaths = [...registered].map(normalize)

function matches(call, route) {
  if (call === route) return true
  const cr = route.split('/').map((s) => (s.startsWith(':') ? '*' : s)).join('/')
  const cc = call.split('/').map((s) => (s.startsWith(':') ? '*' : s)).join('/')
  return cr === cc
}

const missing = []
for (const [path, locs] of called) {
  const norm = normalize(path)
  const ok = bePaths.some((r) => matches(norm, r))
  if (!ok) missing.push([norm, locs])
}

console.log(`Frontend API calls: ${called.size} unique paths`)
console.log(`Backend routes found: ${bePaths.length}`)
if (missing.length === 0) {
  console.log('✅ All frontend calls have matching backend routes')
} else {
  console.log(`\n⚠️  ${missing.length} frontend calls with no obvious backend match:`)
  for (const [p, locs] of missing.sort()) {
    console.log(`  ${p}  (${locs[0]})`)
  }
  console.log('\nNote: verify manually — dynamic paths may be false positives.')
}
