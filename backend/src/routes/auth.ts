import { Router, type Response } from 'express'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import argon2 from 'argon2'
import { eq, or, sql } from 'drizzle-orm'
import { db, schema } from '../db/client'
import { computeUserPermissions } from '../rbac'
import { recordActivity } from '../activity'
import { createSession, destroySession, destroyUserSessions, requireAuth, tokenFromRequest, setSessionCookie, clearSessionCookie } from '../sessions'
import { validate, forgotPasswordSchema, resetPasswordSchema, verifyEmailSchema } from '../validation'

export const authRouter = Router()

const LOCKOUT_THRESHOLD = 5
const LOCKOUT_DURATION_MS = 15 * 60 * 1000

async function checkLockout(identifier: string): Promise<{ locked: boolean; remainingMs: number }> {
  try {
    const { db: getDb, schema } = await import('../db/client')
    if (!getDb) return { locked: false, remainingMs: 0 }
    const rows = await getDb.select().from(schema.loginAttempts)
      .where(eq(schema.loginAttempts.identifier, identifier))
      .limit(1)
    const entry = rows[0]
    if (!entry || !entry.lastAttempt) return { locked: false, remainingMs: 0 }
    const lastAttempt = new Date(entry.lastAttempt).getTime()
    if (Date.now() - lastAttempt > LOCKOUT_DURATION_MS) {
      await getDb.delete(schema.loginAttempts).where(eq(schema.loginAttempts.identifier, identifier))
      return { locked: false, remainingMs: 0 }
    }
    if (entry.count >= LOCKOUT_THRESHOLD) {
      return { locked: true, remainingMs: LOCKOUT_DURATION_MS - (Date.now() - lastAttempt) }
    }
    return { locked: false, remainingMs: 0 }
  } catch {
    return { locked: false, remainingMs: 0 }
  }
}

async function recordFailedAttempt(identifier: string): Promise<void> {
  try {
    const { db: getDb, schema } = await import('../db/client')
    if (!getDb) return
    const now = new Date().toISOString()
    // Atomic upsert. If an entry exists and is within the lockout window,
    // increment the counter; otherwise reset to 1. Because the counter is
    // updated in SQL, concurrent failed logins can't each reset it to 1.
    await getDb.insert(schema.loginAttempts)
      .values({ identifier, count: 1, lastAttempt: now })
      .onConflictDoUpdate({
        target: schema.loginAttempts.identifier,
        set: {
          count: sql`
            CASE
              WHEN ${schema.loginAttempts.lastAttempt} > ${new Date(Date.now() - LOCKOUT_DURATION_MS).toISOString()}
                THEN ${schema.loginAttempts.count} + 1
              ELSE 1
            END
          `,
          lastAttempt: now,
        },
      })
  } catch { /* ignore */ }
}

async function clearFailedAttempts(identifier: string): Promise<void> {
  try {
    const { db: getDb, schema } = await import('../db/client')
    if (!getDb) return
    await getDb.delete(schema.loginAttempts).where(eq(schema.loginAttempts.identifier, identifier))
  } catch { /* ignore */ }
}

function timingSafeTokenCompare(a: string, b: string): boolean {
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

function requireDb(res: Response) {
  if (!db) {
    res.status(503).json({ error: 'Service temporarily unavailable' })
    return false
  }
  return true
}

export function publicUser(user: Record<string, unknown>): Record<string, unknown> {
  const { passwordHash, resetToken, resetTokenExpiry, emailVerificationToken, emailVerificationExpiry, ...rest } = user
  void passwordHash; void resetToken; void resetTokenExpiry; void emailVerificationToken; void emailVerificationExpiry
  return rest
}

authRouter.get('/me', requireAuth, async (req, res) => {
  if (!requireDb(res)) return
  try {
    const userId = req.userId
    if (!userId) return res.status(401).json({ error: 'Not authenticated' })
    const [user] = await db!.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1)
    if (!user) return res.status(404).json({ error: 'User not found' })
    res.json(publicUser(user))
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' })
  }
})

authRouter.post('/logout', requireAuth, async (req, res) => {
  try {
    await destroySession(tokenFromRequest(req))
    clearSessionCookie(res)
    res.json({ ok: true })
  } catch {
    clearSessionCookie(res)
    res.json({ ok: true })
  }
})

authRouter.post('/login', async (req, res) => {
  if (!requireDb(res)) return
  try {
    const identifier = String(req.body?.username ?? '').trim().toLowerCase()
    const password = String(req.body?.password ?? '')
    if (!identifier || !password) {
      return res.status(400).json({ error: 'Username or email and password are required' })
    }

    const lockout = await checkLockout(identifier)
    if (lockout.locked) {
      return res.status(429).json({ error: `Account temporarily locked. Try again in ${Math.ceil(lockout.remainingMs / 60000)} minutes.` })
    }

    const [user] = await db!
      .select()
      .from(schema.users)
      .where(or(eq(schema.users.username, identifier), eq(schema.users.email, identifier)))
      .limit(1)
    if (!user) {
      await recordFailedAttempt(identifier)
      void recordActivity({ action: 'Failed Login Attempt', module: 'system', entity: identifier, details: 'Unknown username or email', ip: req.ip ?? null })
      return res.status(401).json({ error: 'Invalid username or password' })
    }

    if (!user.passwordHash) {
      await recordFailedAttempt(identifier)
      void recordActivity({ action: 'Failed Login Attempt', module: 'system', entity: identifier, details: 'Account has no password set', ip: req.ip ?? null })
      return res.status(401).json({ error: 'Invalid username or password' })
    }
    const valid = await argon2.verify(user.passwordHash, password)
    if (!valid) {
      await recordFailedAttempt(identifier)
      void recordActivity({ action: 'Failed Login Attempt', module: 'system', entity: user.name, details: 'Invalid password', ip: req.ip ?? null })
      return res.status(401).json({ error: 'Invalid username or password' })
    }

    await clearFailedAttempts(identifier)

    if (user.status !== 'active') {
      void recordActivity({ action: 'Failed Login Attempt', module: 'system', entity: user.name, details: 'Account is not active', ip: req.ip ?? null })
      return res.status(403).json({ error: 'This account is not active. Contact an administrator.' })
    }

    const lastLogin = new Date().toISOString()
    await db!
      .update(schema.users)
      .set({ lastLogin })
      .where(eq(schema.users.id, user.id))
    user.lastLogin = lastLogin

    void recordActivity({
      action: 'Logged in',
      module: 'system',
      entity: user.name,
      user: user.name,
      userId: user.id,
      role: user.role ?? null,
      details: `Signed in to the billing software`,
      ip: req.ip ?? null,
    })

    const permissions = await computeUserPermissions(user.id)
    await destroyUserSessions(user.id)
    const token = await createSession(user.id)
    setSessionCookie(res, token)
    res.json({
      user: publicUser(user),
      permissions: permissions?.effective ?? {},
    })
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' })
  }
})

authRouter.post('/forgot-password', validate(forgotPasswordSchema), async (req, res) => {
  if (!requireDb(res)) return
  try {
    const email = String(req.body?.email ?? '').trim().toLowerCase()
    const [user] = await db!.select().from(schema.users).where(eq(schema.users.email, email)).limit(1)
    if (!user) {
      return res.json({ ok: true, message: 'If the email exists, a reset link has been sent' })
    }

    const resetToken = randomBytes(32).toString('hex')
    const resetTokenExpiry = new Date(Date.now() + 60 * 60 * 1000).toISOString()

    await db!.update(schema.users)
      .set({ resetToken, resetTokenExpiry })
      .where(eq(schema.users.id, user.id))

    void recordActivity({
      action: 'Password Reset Requested',
      module: 'system',
      entity: user.name,
      userId: user.id,
      ip: req.ip ?? null,
    })

    res.json({ ok: true, message: 'If the email exists, a reset link has been sent' })
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' })
  }
})

authRouter.post('/reset-password', validate(resetPasswordSchema), async (req, res) => {
  if (!requireDb(res)) return
  try {
    const { token, password } = req.body
    const [user] = await db!.select().from(schema.users).where(eq(schema.users.resetToken, token)).limit(1)
    if (!user || !user.resetToken || !user.resetTokenExpiry || new Date(user.resetTokenExpiry) < new Date()) {
      return res.status(400).json({ error: 'Invalid or expired reset token' })
    }

    if (!timingSafeTokenCompare(token, user.resetToken)) {
      return res.status(400).json({ error: 'Invalid or expired reset token' })
    }

    const passwordHash = await argon2.hash(password, { type: argon2.argon2id })
    await db!.update(schema.users)
      .set({ passwordHash, resetToken: null, resetTokenExpiry: null })
      .where(eq(schema.users.id, user.id))

    await destroyUserSessions(user.id)

    void recordActivity({
      action: 'Password Reset Completed',
      module: 'system',
      entity: user.name,
      userId: user.id,
      ip: req.ip ?? null,
    })

    res.json({ ok: true, message: 'Password has been reset' })
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' })
  }
})

authRouter.post('/verify-email', validate(verifyEmailSchema), async (req, res) => {
  if (!requireDb(res)) return
  try {
    const { token } = req.body
    const [user] = await db!.select().from(schema.users).where(eq(schema.users.emailVerificationToken, token)).limit(1)
    if (!user || !user.emailVerificationExpiry || new Date(user.emailVerificationExpiry) < new Date()) {
      return res.status(400).json({ error: 'Invalid or expired verification token' })
    }

    await db!.update(schema.users)
      .set({ emailVerified: true, emailVerificationToken: null, emailVerificationExpiry: null })
      .where(eq(schema.users.id, user.id))

    void recordActivity({
      action: 'Email Verified',
      module: 'system',
      entity: user.name,
      userId: user.id,
      ip: req.ip ?? null,
    })

    res.json({ ok: true, message: 'Email has been verified' })
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' })
  }
})

authRouter.post('/resend-verification', validate(forgotPasswordSchema), async (req, res) => {
  if (!requireDb(res)) return
  try {
    const email = String(req.body?.email ?? '').trim().toLowerCase()
    const [user] = await db!.select().from(schema.users).where(eq(schema.users.email, email)).limit(1)
    if (!user) {
      return res.json({ ok: true, message: 'If the email exists, a verification link has been sent' })
    }

    if (user.emailVerified) {
      return res.status(400).json({ error: 'Email is already verified' })
    }

    const verificationToken = randomBytes(32).toString('hex')
    const verificationExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

    await db!.update(schema.users)
      .set({ emailVerificationToken: verificationToken, emailVerificationExpiry: verificationExpiry })
      .where(eq(schema.users.id, user.id))

    res.json({ ok: true, message: 'If the email exists, a verification link has been sent' })
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' })
  }
})