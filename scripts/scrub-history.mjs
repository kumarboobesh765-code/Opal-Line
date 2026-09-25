#!/usr/bin/env node
// One-off helper: scrub database credentials out of git history.
//
// Modes:
//   node scripts/scrub-history.mjs extract    -> scan every blob of known files across all refs,
//                                                write redacted copies + rules.txt (oldSha newSha per line)
//   node scripts/scrub-history.mjs --inplace  -> rewrite the known files in the CURRENT working directory
//                                                (meant to be called from `git filter-branch --tree-filter`)
//
// The script never prints secret values - only SHAs, file names and counts.
// Replacement is idempotent: values that are already `REDACTED`/`***` or shell/JS
// templates (${...}) are left untouched.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Files known to have carried DB connection strings / passwords at some point.
const BASE_FILES = [
  'backend/.env.example',
  'backend/src/config.ts',
  'backend/src/routes/db.ts',
  'DEPLOYMENT.md',
  'docker-compose.yml',
  'electron/main.ts',
];

const RULES_FILE = join(REPO_ROOT, 'rules.txt');
const EXTRA_LIST = join(REPO_ROOT, 'scripts', '.scrub-files.json');

function git(args, opts = {}) {
  return execFileSync('git', args, {
    cwd: opts.cwd ?? REPO_ROOT,
    maxBuffer: 64 * 1024 * 1024,
    encoding: 'utf8',
    ...(opts.input !== undefined ? { input: opts.input } : {}),
  });
}

/** A password-looking value: not a template placeholder, not already redacted. */
function isRealSecret(value) {
  if (!value) return false;
  if (value === '***' || value === 'REDACTED') return false;
  if (value.includes('$') || value.includes('{') || value.includes('?')) return false;
  return /^[A-Za-z0-9!@#%^&*_\-+=.]{4,40}$/.test(value);
}

/**
 * postgres://user:password@host/db  ->  postgres://user:REDACTED@host/db
 * Only rewrites when the password segment looks like a real secret.
 */
const URL_CRED = /((?:postgres(?:ql)?(?:\+[a-z0-9]+)?):\/\/)([^:/@\s"']+):([^@/\s"']+)@/g;

/**
 * Env-style secrets: PGPASSWORD=x, POSTGRES_PASSWORD="x", docker ${PGPASSWORD:-x}
 * Keeps the surrounding syntax ($, -, quotes) intact, redacts only the value.
 */
const ENV_CRED =
  /((?:PGPASSWORD|POSTGRES_PASSWORD|DB_PASSWORD|DATABASE_PASSWORD)[=:])(-?)("?)((?:[^\s"',)\]}])*)\3/g;

export function scrubText(text) {
  let changed = false;

  let out = text.replace(URL_CRED, (m, scheme, user, pass) => {
    if (!isRealSecret(pass)) return m;
    changed = true;
    return `${scheme}${user}:REDACTED@`;
  });

  out = out.replace(ENV_CRED, (m, prefix, dash, quote, value) => {
    if (!isRealSecret(value)) return m;
    changed = true;
    return `${prefix}${dash}${quote}REDACTED${quote}`;
  });

  return changed ? out : null;
}

function scrubStringIfChanged(s) {
  return scrubText(s);
}

/** --inplace: scrub the known files in process.cwd() (the filter-branch temp tree). */
function runInplace() {
  let files = BASE_FILES;
  if (existsSync(EXTRA_LIST)) {
    try {
      const extra = JSON.parse(readFileSync(EXTRA_LIST, 'utf8'));
      if (Array.isArray(extra)) files = [...new Set([...BASE_FILES, ...extra])];
    } catch {
      /* ignore malformed list */
    }
  }
  for (const rel of files) {
    const p = join(process.cwd(), rel);
    if (!existsSync(p)) continue;
    const before = readFileSync(p, 'utf8');
    const after = scrubStringIfChanged(before);
    if (after !== null) writeFileSync(p, after);
  }
}

/** extract: scan all blobs of known files, write redacted copies + rules.txt */
function runExtract() {
  const revs = git(['rev-list', '--all']).split('\n').filter(Boolean);

  // Broad sweep: which files anywhere in history mention password env vars?
  const extraFiles = new Set();
  for (const rev of revs) {
    try {
      const names = git(['grep', '-I', '-l', '-E', '(PGPASSWORD|POSTGRES_PASSWORD|DB_PASSWORD)[=:]', rev])
        .split('\n')
        .filter(Boolean)
        .map((line) => line.slice(rev.length + 1));
      for (const n of names) extraFiles.add(n);
    } catch {
      /* no match in this rev */
    }
  }

  const allFiles = [...new Set([...BASE_FILES, ...extraFiles])];

  // Collect blob SHAs for those paths across history.
  const blobShas = new Map(); // sha -> path (first seen)
  const args = ['rev-list', '--objects', '--all', '--', ...allFiles];
  for (const line of git(args).split('\n').filter(Boolean)) {
    const [sha, ...rest] = line.split(' ');
    const path = rest.join(' ');
    if (path && allFiles.includes(path)) blobShas.set(sha, path);
  }

  const rules = [];
  const touched = new Set();
  for (const [sha, path] of [...blobShas.entries()].sort((a, b) => a[1].localeCompare(b[1]))) {
    const content = git(['cat-file', 'blob', sha]);
    const cleaned = scrubStringIfChanged(content);
    if (cleaned === null) continue;
    const newSha = execFileSync('git', ['hash-object', '-w', '--stdin'], {
      cwd: REPO_ROOT,
      input: cleaned,
      encoding: 'utf8',
    }).trim();
    if (newSha !== sha) {
      rules.push(`${sha} ${newSha}`);
      touched.add(path);
    }
  }

  writeFileSync(RULES_FILE, rules.join('\n') + (rules.length ? '\n' : ''));
  writeFileSync(EXTRA_LIST, JSON.stringify([...touched], null, 2) + '\n');

  console.log(`revs scanned:        ${revs.length}`);
  console.log(`files swept:         ${allFiles.length}`);
  console.log(`files with secrets:  ${touched.size}`);
  for (const f of [...touched].sort()) console.log(`  - ${f}`);
  console.log(`blobs rewritten:     ${rules.length}`);
  console.log('rules written to rules.txt');
}

const mode = process.argv[2] ?? '';
if (mode === '--inplace') {
  runInplace();
} else if (mode === 'extract') {
  runExtract();
} else {
  console.error('usage: node scripts/scrub-history.mjs [extract | --inplace]');
  process.exit(2);
}
