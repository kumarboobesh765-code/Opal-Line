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
 *     automatically on port 47193)
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

// The EnterpriseDB "binaries" zip is a full development distribution: it
// ships pgAdmin 4 (~16,600 files), StackBuilder, server headers, the full docs
// tree and debug symbols. None of it is used at runtime — we only ever exec
// bin/initdb.exe + bin/pg_ctl.exe and let them load lib/ and share/. Shipping
// it verbatim added ~700 MB to the installer and made electron-builder
// code-sign ~20,000 files one at a time (a >1 hour build).
const PG_PRUNE_DIRS = ['pgAdmin 4', 'StackBuilder', 'doc', 'include', 'symbols']

function prunePortablePostgres() {
  let removed = 0
  for (const dir of PG_PRUNE_DIRS) {
    const target = path.join(PG_DIR, dir)
    if (fs.existsSync(target)) {
      fs.rmSync(target, { recursive: true, force: true })
      removed++
    }
  }
  if (removed > 0) console.log(`  Pruned ${removed} unused PostgreSQL director${removed === 1 ? 'y' : 'ies'} (pgAdmin 4, StackBuilder, doc, include, symbols).`)
}

async function ensurePortablePostgres() {
  const pgBin = path.join(PG_DIR, 'bin', 'pg_ctl.exe')
  if (fs.existsSync(pgBin)) {
    console.log('  PostgreSQL already bundled.')
    prunePortablePostgres()
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
    prunePortablePostgres()
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

  // Clean dist/ first to avoid stale artifacts (e.g. leaked .env files)
  if (fs.existsSync(backendDist)) {
    console.log('  Cleaning backend/dist/...')
    fs.rmSync(backendDist, { recursive: true, force: true })
  }
  mkdirp(backendDist)
  run('cd backend && npx tsc --outDir dist')

  // Bundle the backend entry to a single CJS file (this is what Electron runs).
  // MUST be rebuilt from current source every time — a stale index.cjs was the
  // cause of the first installer's missing-bootstrap failure.
  run('cd backend && npx esbuild src/index.ts --bundle --platform=node --format=cjs --outfile=dist/index.cjs --external:argon2 --external:better-sqlite3')

  // FIX: esbuild CJS output sets `import_meta = {}` breaking pdfkit's ICC path.
  // Patch it so import_meta.url resolves to the bundle file URL.
  // Also patch createRequire to resolve #standard-fonts/* from pdfkit's package.json.
  const bundlePath = path.join(backendDist, 'index.cjs')
  let bundle = fs.readFileSync(bundlePath, 'utf8')
  const urlShim = 'const { pathToFileURL: _ptf } = require("url"); import_meta = { url: _ptf(__filename).href };'
  bundle = bundle.replaceAll('import_meta = {};', urlShim)
  const oldCR = 'require$1 = (0, import_module.createRequire)(import_meta.url);'
  const newCR = 'var { join: _pj } = require("path"); require$1 = (0, import_module.createRequire)(_pj(__dirname, "node_modules", "pdfkit", "package.json"));'
  bundle = bundle.replace(oldCR, newCR)
  fs.writeFileSync(bundlePath, bundle)
  console.log('  Patched import_meta.url + createRequire for pdfkit')

  // Copy esbuild-externalized native addons + their transitive deps.
  // esbuild --external:argon2 means require('argon2') is left as-is at runtime,
  // so we need the actual node_modules package (with its own deps) available.
  const nativePkgs = ['argon2', '@phc', 'node-addon-api', 'node-gyp-build']
  const nmDest = path.join(backendDist, 'node_modules')
  mkdirp(nmDest)
  for (const pkg of nativePkgs) {
    const src = path.join(ROOT, 'node_modules', pkg)
    const dst = path.join(nmDest, pkg)
    if (fs.existsSync(src)) {
      copyDir(src, dst)
      console.log(`  Copied native dep: ${pkg}`)
    }
  }

  // Copy pdfkit runtime files (standard-fonts, data, package.json) so
  // createRequire can resolve #standard-fonts/* subpath imports at runtime.
  const pdfkitSrc = path.join(ROOT, 'node_modules', 'pdfkit')
  const pdfkitDest = path.join(nmDest, 'pdfkit')
  mkdirp(path.join(pdfkitDest, 'js', 'standard-fonts'))
  mkdirp(path.join(pdfkitDest, 'js', 'data'))
  fs.copyFileSync(path.join(pdfkitSrc, 'package.json'), path.join(pdfkitDest, 'package.json'))
  const stdFontsSrc = path.join(pdfkitSrc, 'js', 'standard-fonts')
  if (fs.existsSync(stdFontsSrc)) {
    copyDir(stdFontsSrc, path.join(pdfkitDest, 'js', 'standard-fonts'))
  }
  const iccSrc = path.join(backendDist, 'data', 'sRGB_IEC61966_2_1.icc')
  if (fs.existsSync(iccSrc)) {
    fs.copyFileSync(iccSrc, path.join(pdfkitDest, 'js', 'data', 'sRGB_IEC61966_2_1.icc'))
  }
  console.log('  Copied pdfkit runtime (standard-fonts + data)')

  // SECURITY: Remove any .env files that tsc may have copied into dist/
  // The Electron app generates its own .env in %APPDATA% on first run.
  const envFiles = [
    path.join(backendDist, '.env'),
    path.join(backendDist, '.env.local'),
    path.join(backendDist, '.env.production'),
  ]
  for (const f of envFiles) {
    if (fs.existsSync(f)) {
      console.log(`  ⚠️  Removing secret file from bundle: ${path.basename(f)}`)
      fs.unlinkSync(f)
    }
  }

  // Copy drizzle folder (used by migrate tooling)
  const drizzleSrc = path.join(ROOT, 'backend', 'drizzle')
  const drizzleDest = path.join(backendDist, 'drizzle')
  if (fs.existsSync(drizzleSrc)) copyDir(drizzleSrc, drizzleDest)

  // Step 3: Portable PostgreSQL (optional but recommended)
  console.log('\n3️⃣  Bundling PostgreSQL...')
  const hasPg = await ensurePortablePostgres()

  // PostgreSQL's exes link against the VC++ 2015-2022 runtime, which fresh
  // Windows machines may not have installed. Ship the redistributable DLLs
  // next to the pg binaries — Windows prefers application-dir DLLs, so the
  // bundled copies are used without needing a system-wide install.
  if (hasPg) {
    const redist = ['msvcp140.dll', 'msvcp140_1.dll', 'msvcp140_2.dll', 'vcruntime140.dll', 'vcruntime140_1.dll']
    const sys32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32')
    let bundled = 0
    for (const dll of redist) {
      const src = path.join(sys32, dll)
      const dst = path.join(PG_DIR, 'bin', dll)
      if (fs.existsSync(src) && !fs.existsSync(dst)) {
        fs.copyFileSync(src, dst)
        bundled++
      }
    }
    console.log(
      bundled > 0
        ? `  Bundled ${bundled} VC++ runtime DLL(s) with PostgreSQL`
        : '  VC++ runtime DLLs already present with PostgreSQL',
    )
  }

  // Step 4: Compile Electron
  console.log('\n4️⃣  Compiling Electron main process...')
  run('cd electron && npx tsc')

  // Step 5: Build installer
  console.log('\n5️⃣  Building Windows installer...')
  run('npx electron-builder --config electron/electron-builder.yml --win')

  console.log('\n✅ Build complete!')
  const { version } = require(path.join(ROOT, 'package.json'))
  console.log(`📦 Installer: dist-electron/Opal Line Billing-Setup-${version}.exe`)
  console.log(hasPg
    ? '   ✔ Bundled PostgreSQL — target PCs need NOTHING pre-installed.'
    : '   ⚠ No PostgreSQL bundled — target PCs need PostgreSQL or DATABASE_URL.')
}

main().catch((err) => {
  console.error('Build failed:', err)
  process.exit(1)
})
