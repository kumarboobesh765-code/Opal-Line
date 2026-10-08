// app.log is append-only from several sources (backend stdout/stderr, update
// steps, installer notes) and nothing ever bounded it — on one machine it
// reached 5.5 GB. Prune it in place: only check the size after ~LOG_MAX_BYTES
// of new appends (the first call forces a check, so an oversized legacy file
// is reclaimed on the next launch), and when it exceeds the cap keep only the
// newest LOG_KEEP_BYTES so the System Status log viewer still has recent
// history to show.
import { statSync, openSync, readSync, closeSync, writeFileSync } from 'node:fs'

export const LOG_MAX_BYTES = 5 * 1024 * 1024
export const LOG_KEEP_BYTES = 1024 * 1024

let bytesSinceCheck = LOG_MAX_BYTES // force a size check on the very first line

/** Test hook: next pruneLog call always measures the file. */
export function resetLogRotateStateForTests(): void {
  bytesSinceCheck = LOG_MAX_BYTES
}

export function pruneLogIfTooBig(file: string, added: number): void {
  bytesSinceCheck += added
  if (bytesSinceCheck < LOG_MAX_BYTES) return
  bytesSinceCheck = 0
  try {
    const size = statSync(file).size
    if (size <= LOG_MAX_BYTES) return
    const keep = Math.min(size, LOG_KEEP_BYTES)
    const buf = Buffer.alloc(keep)
    const fd = openSync(file, 'r')
    try {
      readSync(fd, buf, 0, keep, size - keep)
    } finally {
      closeSync(fd)
    }
    // Truncate to just the newest bytes. logLine appends with 'a', so
    // concurrent writers land at the new EOF — no offsets go stale.
    writeFileSync(file, buf)
  } catch { /* log maintenance must never break logging */ }
}
