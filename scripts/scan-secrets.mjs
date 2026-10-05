// Fail if a credential-bearing file or a hardcoded secret is tracked in git.
//
// The repo is public, so a committed session cookie or token is world-readable
// even after the commit is deleted from the default branch. This scans the
// files git actually tracks (not the working tree) so an ignored-but-present
// file never fails the build.
//
// Usage: node scripts/scan-secrets.mjs
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

// Paths that must never be tracked. Matched against the repo-relative path.
// `.env.example` is the documented exception - it holds placeholders, not values.
const FORBIDDEN_PATHS = [
  /(^|\/)\.env$/,
  /(^|\/)\.env\.(?!example$)[^/]+$/,
  /(^|\/)\.encryption-key$/,
  /(^|\/)\.csrf-secret$/,
  /\.pfx$/i,
  /\.p12$/i,
  /\.pem$/i,
  /\.key$/i,
  // Playwright auth state carries a live session cookie. This is the exact
  // file that leaked in the pmain lineage and had to be unpublished.
  /(^|\/)\.auth\/state\.json$/,
  /(^|\/)playwright\.auth\//,
  /\.pre-scrub-backup\.bundle$/,
]

// High-confidence secret shapes. Each must be long enough that a placeholder
// or a hash fragment does not trip it.
const SECRET_PATTERNS = [
  { name: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g },
  { name: 'GitHub fine-grained PAT', re: /\bgithub_pat_[A-Za-z0-9_]{50,}\b/g },
  { name: 'Slack token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g },
  { name: 'private key block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  // A session cookie value as stored by Playwright: 64 hex chars.
  { name: 'session cookie value', re: /"value"\s*:\s*"[a-f0-9]{64,}"/g },
  { name: 'AWS access key id', re: /\bAKIA[0-9A-Z]{16}\b/g },
]

// Skip these: lockfiles and vendored/minified output are huge and false-positive
// prone. Only tracked files are scanned, so node_modules is never included.
const SKIP = [
  /package-lock\.json$/,
  /\.min\.(js|css)$/,
  /\/dist\//,
]

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
}

const files = git('ls-files', '-z').split('\0').filter(Boolean)
const findings = []

for (const file of files) {
  const normalized = file.replace(/\\/g, '/')

  if (SKIP.some((re) => re.test(normalized))) continue

  const forbidden = FORBIDDEN_PATHS.find((re) => re.test(normalized))
  if (forbidden) {
    findings.push({ file: normalized, line: 0, kind: 'forbidden path' })
    continue
  }

  // Binary files (PNGs, .exe assets) cannot hold a text secret worth matching.
  let text
  try {
    const buf = readFileSync(normalized)
    if (buf.includes(0)) continue // NUL byte => binary
    text = buf.toString('utf8')
  } catch {
    continue // unreadable (symlink, race); not this check's job to report
  }

  const lines = text.split('\n')
  lines.forEach((line, i) => {
    for (const { name, re } of SECRET_PATTERNS) {
      // Fresh regex per line: the global flag makes lastIndex stateful.
      if (new RegExp(re.source, re.flags).test(line)) {
        findings.push({ file: normalized, line: i + 1, kind: name })
      }
    }
  })
}

if (findings.length === 0) {
  console.log(`scan-secrets: clean (${files.length} tracked files scanned)`)
  process.exit(0)
}

console.error(`scan-secrets: ${findings.length} potential secret(s) committed\n`)
for (const f of findings) {
  const where = f.line ? `${f.file}:${f.line}` : f.file
  console.error(`  ${where}  (${f.kind})`)
}
console.error(
  '\nIf any of these is a real credential, treat it as compromised: rotate it' +
    '\nserver-side. Deleting the commit is not enough on a public repository.',
)
process.exit(1)