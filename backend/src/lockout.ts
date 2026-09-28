/**
 * Pure decision logic for account lockout after repeated failed logins.
 *
 * The persistence lives in the `login_attempts` table (upsert in
 * routes/auth.ts); this module holds the decision rules so they can be unit
 * tested without a database. The SQL upsert in auth.ts mirrors exactly this
 * contract:
 *   - fewer than LOCKOUT_THRESHOLD failures inside the window → allowed
 *   - LOCKOUT_THRESHOLD or more failures inside the window → locked until
 *     window end (LOCKOUT_DURATION_MS measured from the last failure)
 *   - a fresh attempt after the window → counter restarts at 1
 */
export const LOCKOUT_THRESHOLD = 5
export const LOCKOUT_DURATION_MS = 15 * 60 * 1000

export type LockoutDecision =
  | { decision: 'allowed'; count: number }
  | { decision: 'locked'; retryableAt: number }
  | { decision: 'reset'; count: 1 }

/**
 * Decide what should happen on a failed login given the stored attempt state.
 *
 * @param storedCount  Counter currently persisted for this identifier (0 if none).
 * @param lastAttemptMs Epoch ms of the last stored failure (undefined if none).
 * @param nowMs        Current epoch ms.
 */
export function decideLockout(
  storedCount: number,
  lastAttemptMs: number | undefined,
  nowMs: number,
): LockoutDecision {
  const withinWindow =
    lastAttemptMs !== undefined &&
    Number.isFinite(lastAttemptMs) &&
    nowMs - lastAttemptMs < LOCKOUT_DURATION_MS

  if (!withinWindow) {
    // Window has lapsed (or nothing stored): the next failure restarts at 1.
    return { decision: 'reset', count: 1 }
  }

  const count = storedCount + 1
  if (count >= LOCKOUT_THRESHOLD) {
    return { decision: 'locked', retryableAt: lastAttemptMs + LOCKOUT_DURATION_MS }
  }
  return { decision: 'allowed', count }
}
