#!/usr/bin/env node

/**
 * Build script for the Opal Line Desktop App.
 *
 * Steps:
 * 1. Build frontend (already in frontend/dist)
 * 2. Compile backend TypeScript to JavaScript
 * 3. Copy necessary runtime files into dist-electron-app
 * 4. Compile Electron main process
 * 5. Run electron-builder to create the Windows installer
 */

const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')

function run(cmd, opts = {}) {
  console.log(`  > ${cmd}`)
  execSync(cmd, { cwd: ROOT, stdio: 'inherit', ...opts })
}

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

function copyDir(src, dest) {
  mkdirp(dest)
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath)
    } else {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}

console.log('🔨 Building Opal Line Desktop App...\n')

// Step 1: Build frontend
console.log('1️⃣  Building frontend...')
run('npm run build -w frontend')

// Step 2: Compile backend
console.log('\n2️⃣  Compiling backend...')
const backendDist = path.join(ROOT, 'backend', 'dist')
mkdirp(backendDist)
run('cd backend && npx tsc --outDir dist')

// Copy drizzle config and migrations
const drizzleFiles = ['drizzle.config.ts']
for (const f of drizzleFiles) {
  const src = path.join(ROOT, 'backend', f)
  const dest = path.join(backendDist, f)
  if (fs.existsSync(src)) fs.copyFileSync(src, dest)
}

// Copy drizzle folder
const drizzleSrc = path.join(ROOT, 'backend', 'drizzle')
const drizzleDest = path.join(backendDist, 'drizzle')
if (fs.existsSync(drizzleSrc)) {
  copyDir(drizzleSrc, drizzleDest)
}

// Copy .env if it exists
const envSrc = path.join(ROOT, 'backend', '.env')
const envDest = path.join(backendDist, '.env')
if (fs.existsSync(envSrc)) fs.copyFileSync(envSrc, envDest)

// Step 3: Compile Electron
console.log('\n3️⃣  Compiling Electron main process...')
run('cd electron && npx tsc')

// Step 4: Copy compiled backend into dist-electron-app
console.log('\n4️⃣  Bundling backend into app...')
const appDir = path.join(ROOT, 'dist-electron-app')
const appBackend = path.join(appDir, 'backend')
mkdirp(appBackend)

// Copy compiled backend JS
copyDir(backendDist, appBackend)

// Copy backend node_modules (only the ones needed at runtime)
const backendNodeModules = path.join(ROOT, 'backend', 'node_modules')
if (fs.existsSync(backendNodeModules)) {
  const appNodeModules = path.join(appBackend, 'node_modules')
  copyDir(backendNodeModules, appNodeModules)
}

// Copy frontend dist
const appFrontend = path.join(appDir, 'frontend', 'dist')
mkdirp(appFrontend)
copyDir(path.join(ROOT, 'frontend', 'dist'), appFrontend)

// Step 5: Build installer
console.log('\n5️⃣  Building Windows installer...')
run('npx electron-builder --config electron/electron-builder.yml --win')

console.log('\n✅ Build complete!')
console.log('📦 Installer: dist-electron/Opal Line Billing-Setup-1.0.0.exe')
