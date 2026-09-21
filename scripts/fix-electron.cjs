// One-off helper: extract the cached Electron zip into node_modules/electron/dist
const path = require('path')
const fs = require('fs')
const os = require('os')
const extract = require('extract-zip')

const pkg = require(path.join(process.cwd(), 'node_modules', 'electron', 'package.json'))
const cacheDir = path.join(os.homedir(), 'AppData', 'Local', 'electron', 'Cache')

function findZip(dir) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name)
    if (f.isDirectory()) {
      const r = findZip(p)
      if (r) return r
    } else if (f.name === 'electron-v' + pkg.version + '-win32-x64.zip') {
      return p
    }
  }
  return null
}

const zip = findZip(cacheDir)
if (!zip) {
  console.error('zip not found in', cacheDir)
  process.exit(1)
}
const dest = path.join(process.cwd(), 'node_modules', 'electron', 'dist')
console.log('extracting', zip, '->', dest)
extract(zip, { dir: dest })
  .then(() => {
    fs.writeFileSync(path.join(process.cwd(), 'node_modules', 'electron', 'path.txt'), 'electron.exe')
    console.log('OK extracted, path.txt written')
  })
  .catch((e) => {
    console.error('FAILED:', e.message)
    process.exit(1)
  })
