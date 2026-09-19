#!/usr/bin/env node

/**
 * Build script for the Opal Line Desktop App.
 *
 * Steps:
 * 1. Build frontend
 * 2. Compile backend TypeScript to a single CJS bundle + runtime node_modules
 * 3. Bundle portable PostgreSQL (downloaded once into backend/pgsql) — optional
 * 4. Compile Electron main process
 * 5. Run electron-builder to create the Windows installer
 *
 * The resulting installer:
 *   - requires NO pre-installed Node.js (backend runs via ELECTRON_RUN_AS_NODE)
 *   - requires NO pre-installed PostgreSQL (portable PG is initialized into
 *     %APPDATA%\Opal Line Billing\pgdata on first launch and started
 *     automatically on port 5433)
 *   - performs first-run DB schema bootstrap + admin seeding automatically
 */

const { execSync, execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const https = require('https')

const ROOT = path.resolve(__dirname, '..')
const PG_DIR = path.join(ROOT, 'backend', 'pgsql')
const PG_VERSION = '16.4'
// EnterpriseDB binaries (zip): windows x64 portables
const PG_URL = `https://get.enterprisedb.com/postgresql/postgresql-${PG_VERSION}-1-windows-x64-binaries.zip`

function run(cmd, opts = {}) {
  console.log(`  > ${cmd}`)
  execSync(cmd, { cwd: ROOT, stdio: 'inherit', ...opts })
}

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

function copyDir(src, dest, skip = []) {
  mkdirp(dest)
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (skip.includes(entry.name)) continue
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath, skip)
    } else {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}

function downloadTo(url, dest) {
  return new Promise((resolveP, rejectP) => {
    const file = fs.createWriteStream(dest)
    const go = (u, redirects) => {
      https.get(u, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume()
          if (redirects > 5) return rejectP(new Error('Too many redirects'))
          return go(res.headers.location, redirects + 1)
        }
        if (res.statusCode !== 200) return rejectP(new Error(`HTTP ${res.statusCode} for ${u}`))
        res.pipe(file)
        file.on('finish', () => file.close(resolveP))
      }).on('error', rejectP)
    }
    go(url, 0)
  })
}

async function ensurePortablePostgres() {
  const pgBin = path.join(PG_DIR, 'bin', 'pg_ctl.exe')
  if (fs.existsSync(pgBin)) {
    console.log('  PostgreSQL already bundled.')
    fs.writeFileSync(path.join(ROOT, 'backend', 'pgsql-present.flag'), new Date().toISOString())
    return true
  }
  console.log(`  Downloading portable PostgreSQL ${PG_VERSION} (~330 MB)…`)
  const zip = path.join(ROOT, 'pg-binaries.tmp.zip')
  try {
    await downloadTo(PG_URL, zip)
    console.log('  Extracting…')
    // PowerShell Expand-Archive keeps the top-level pgsql/ folder
    execSync(
      `powershell -NoProfile -Command "Expand-Archive -Force -LiteralPath '${zip}' -DestinationPath '${ROOT}\\pg-tmp'"`,
      { stdio: 'inherit', timeout: 10 * 60 * 1000 },
    )
    const extracted = path.join(ROOT, 'pg-tmp', 'pgsql')
    if (!fs.existsSync(path.join(extracted, 'bin', 'pg_ctl.exe'))) {
      throw new Error('unexpected archive layout')
    }
    mkdirp(path.dirname(PG_DIR))
    fs.renameSync(extracted, PG_DIR)
    fs.rmSync(zip, { force: true })
    fs.rmSync(path.join(ROOT, 'pg-tmp'), { recursive: true, force: true })
    console.log('  PostgreSQL bundled at backend/pgsql')
    fs.writeFileSync(path.join(ROOT, 'backend', 'pgsql-present.flag'), new Date().toISOString())
    return true
  } catch (err) {
    console.warn(`  ⚠️  Could not bundle PostgreSQL (${err.message}).`)
    console.warn('     Installer will still build; users need PostgreSQL or DATABASE_URL at runtime.')
    try { fs.rmSync(zip, { force: true }) } catch {}
    fs.rmSync(path.join(ROOT, 'backend', 'pgsql-present.flag'), { force: true })
    return false
  }
}

async function main() {
  console.log('🔨 Building Opal Line Desktop App...\n')

  // Step 1: Build frontend
  console.log('1️⃣  Building frontend...')
  run('npm run build -w frontend')

  // Step 2: Compile backend
  console.log('\n2️⃣  Compiling backend...')
  const backendDist = path.join(ROOT, 'backend', 'dist')
  mkdirp(backendDist)
  run('cd backend && npx tsc --outDir dist')

  // Copy drizzle folder (used by migrate tooling)
  const drizzleSrc = path.join(ROOT, 'backend', 'drizzle')
  const drizzleDest = path.join(backendDist, 'drizzle')
  if (fs.existsSync(drizzleSrc)) copyDir(drizzleSrc, drizzleDest)

  // Step 3: Portable PostgreSQL (optional but recommended)
  console.log('\n3️⃣  Bundling PostgreSQL...')
  const hasPg = await ensurePortablePostgres()

  // Step 4: Compile Electron
  console.log('\n4️⃣  Compiling Electron main process...')
  run('cd electron && npx tsc')

  // Step 5: Build installer
  console.log('\n5️⃣  Building Windows installer...')
  run('npx electron-builder --config electron/electron-builder.yml --win')

  console.log('\n✅ Build complete!')
  console.log('📦 Installer: dist-electron/Opal Line Billing-Setup-1.0.0.exe')
  console.log(hasPg
    ? '   ✔ Bundled PostgreSQL — target PCs need NOTHING pre-installed.'
    : '   ⚠ No PostgreSQL bundled — target PCs need PostgreSQL or DATABASE_URL.')
}

main().catch((err) => {
  console.error('Build failed:', err)
  process.exit(1)
})
