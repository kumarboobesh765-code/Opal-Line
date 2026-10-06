import { timingSafeEqual } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { CONSTANTS } from './constants'
import { db, schema } from './db/client'
import { decryptSecret, encryptSecret } from './lib/crypto'

/**
 * Superadmin recovery password.
 *
 * If the owner forgets their login password they can type the stable recovery
 * password into the normal Password box on the sign-in screen — it works as
 * the password itself, but only for owner-level accounts (Admin / Super Admin)
 * and only at the account the recovery password is presented for. The value is
 *
 *   1. the built-in constant (CONSTANTS.SUPERADMIN_RECOVERY_PASSWORD) by
 *      default — identical on every install, and
 *   2. an optional rotated value stored encrypted (encV1, AES-256-GCM under the
 *      app's master key) in settings.notificationSettings.recoveryPasswordEncrypted
 *      via Settings → Security.
 *
 * Every use is recorded in the activity log, the login lockout still applies
 * to failed attempts, and non-owner roles are rejected before any comparison.
 */

/** Roles the recovery password may ever sign in for. */
const RECOVERY_ROLES: ReadonlyArray<string> = ['Admin', 'Super Admin']

/** Key inside settings.notificationSettings holding the rotated value. */
export const RECOVERY_PASSWORD_KEY = 'recoveryPasswordEncrypted'

export function isRecoveryRole(role: unknown): boolean {
  return typeof role === 'string' && RECOVERY_ROLES.includes(role)
}

/** Constant-time string compare — the stored value must never leak via timing. */
export function timingSafeStringEqual(a: string, b: string): boolean {
  const maxLen = Math.max(a.length, b.length)
  const bufA = Buffer.alloc(maxLen, 0)
  const bufB = Buffer.alloc(maxLen, 0)
  bufA.write(a)
  bufB.write(b)
  try {
    return timingSafeEqual(bufA, bufB) && a.length === b.length
  } catch {
    return false
  }
}

/**
 * Pure decision: may `provided` act as the recovery password for a user with
 * `role`, given the currently stored `stored` value? Role is checked before
 * any comparison so a non-owner can never match by accident.
 */
export function recoveryMatches(role: unknown, provided: string, stored: string): boolean {
  if (!isRecoveryRole(role)) return false
  if (!provided || !stored) return false
  return timingSafeStringEqual(provided, stored)
}

async function storedEncryptedValue(): Promise<string | null> {
  if (!db) return null
  try {
    const [row] = await db
      .select({ notificationSettings: schema.settings.notificationSettings })
      .from(schema.settings)
      .where(eq(schema.settings.id, 'app'))
      .limit(1)
    const ns = row?.notificationSettings as Record<string, unknown> | null
    const enc = ns?.[RECOVERY_PASSWORD_KEY]
    return typeof enc === 'string' && enc ? enc : null
  } catch {
    return null
  }
}

/** The effective recovery password: rotated value if set, else the built-in constant. */
export async function getRecoveryPassword(): Promise<string> {
  const enc = await storedEncryptedValue()
  if (enc) {
    try {
      const value = decryptSecret(enc)
      if (value) return value
    } catch {
      // Fall through to the constant — a bad value must never brick login.
    }
  }
  return CONSTANTS.SUPERADMIN_RECOVERY_PASSWORD
}

/** Whether the install still uses the built-in default or a rotated value. */
export async function getRecoveryPasswordSource(): Promise<'default' | 'custom'> {
  const enc = await storedEncryptedValue()
  if (!enc) return 'default'
  try {
    return decryptSecret(enc) ? 'custom' : 'default'
  } catch {
    return 'default'
  }
}

/**
 * Login-path check: does `provided` match the recovery password for `role`?
 * Non-owner roles are rejected without touching the database.
 */
export async function isRecoveryLogin(role: unknown, provided: string): Promise<boolean> {
  if (!isRecoveryRole(role) || !provided) return false
  return recoveryMatches(role, provided, await getRecoveryPassword())
}

/** Rotate the recovery password (stored encrypted). Owner routes call this. */
export async function setRecoveryPassword(value: string): Promise<void> {
  if (!db) throw new Error('Database unavailable')
  const [row] = await db
    .select({ notificationSettings: schema.settings.notificationSettings })
    .from(schema.settings)
    .where(eq(schema.settings.id, 'app'))
    .limit(1)
  const ns = { ...(row?.notificationSettings as Record<string, unknown> | null) }
  ns[RECOVERY_PASSWORD_KEY] = encryptSecret(value)
  await db
    .update(schema.settings)
    .set({ notificationSettings: ns })
    .where(eq(schema.settings.id, 'app'))
}

/** Drop the rotated value — the built-in constant becomes effective again. */
export async function clearRecoveryPassword(): Promise<void> {
  if (!db) throw new Error('Database unavailable')
  const [row] = await db
    .select({ notificationSettings: schema.settings.notificationSettings })
    .from(schema.settings)
    .where(eq(schema.settings.id, 'app'))
    .limit(1)
  const ns = { ...(row?.notificationSettings as Record<string, unknown> | null) }
  delete ns[RECOVERY_PASSWORD_KEY]
  await db
    .update(schema.settings)
    .set({ notificationSettings: ns })
    .where(eq(schema.settings.id, 'app'))
}
