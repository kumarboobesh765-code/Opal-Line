import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import argon2 from 'argon2'
import { CONSTANTS } from './constants'
import {
  getRecoveryPasswordHash,
  getRecoveryPasswordSource,
  isRecoveryLogin,
  isRecoveryRole,
} from './recoveryPassword'

/**
 * The built-in value documented in docs/recovery-password.md. Pinned here so
 * a value/hash mismatch fails in unit tests, not only in e2e — the source
 * itself keeps only CONSTANTS.SUPERADMIN_RECOVERY_PASSWORD_HASH (argon2id).
 */
const BUILT_IN_RECOVERY_PASSWORD = 'Ajith130503@'

test('the built-in recovery password satisfies the strong password policy', () => {
  const value = BUILT_IN_RECOVERY_PASSWORD
  assert.ok(value.length >= 8, 'at least 8 characters')
  assert.ok(/[A-Z]/.test(value), 'has an uppercase letter')
  assert.ok(/[a-z]/.test(value), 'has a lowercase letter')
  assert.ok(/[0-9]/.test(value), 'has a digit')
  assert.ok(/[^A-Za-z0-9]/.test(value), 'has a special character')
})

test('the built-in recovery password is stored only as an argon2id hash', () => {
  const hash = CONSTANTS.SUPERADMIN_RECOVERY_PASSWORD_HASH
  assert.ok(hash.startsWith('$argon2id$'), 'an argon2id hash string')
  assert.ok(!/Ajith/i.test(hash), 'the plaintext never appears in the constant')
  assert.ok(!hash.includes('OpalLine'), 'nor does any earlier plaintext value')
})

test('the built-in value verifies against the stored hash', async () => {
  assert.equal(await argon2.verify(CONSTANTS.SUPERADMIN_RECOVERY_PASSWORD_HASH, BUILT_IN_RECOVERY_PASSWORD), true)
  assert.equal(await argon2.verify(CONSTANTS.SUPERADMIN_RECOVERY_PASSWORD_HASH, `${BUILT_IN_RECOVERY_PASSWORD}x`), false)
  assert.equal(await argon2.verify(CONSTANTS.SUPERADMIN_RECOVERY_PASSWORD_HASH, ''), false)
})

test('only owner roles are recovery roles', () => {
  assert.equal(isRecoveryRole('Admin'), true)
  assert.equal(isRecoveryRole('Super Admin'), true)
  assert.equal(isRecoveryRole('Manager'), false)
  assert.equal(isRecoveryRole('Sales'), false)
  assert.equal(isRecoveryRole(null), false)
  assert.equal(isRecoveryRole(undefined), false)
  assert.equal(isRecoveryRole(''), false)
  // A role crafted to contain an owner name must not match.
  assert.equal(isRecoveryRole('Super Admin '), false)
  assert.equal(isRecoveryRole('admin'), false)
})

test('isRecoveryLogin gates on the owner role before verifying', async () => {
  // Correct value, non-owner role → rejected without ever running argon2.
  assert.equal(await isRecoveryLogin('Manager', BUILT_IN_RECOVERY_PASSWORD), false)
  assert.equal(await isRecoveryLogin('Sales', BUILT_IN_RECOVERY_PASSWORD), false)
  assert.equal(await isRecoveryLogin(null, BUILT_IN_RECOVERY_PASSWORD), false)
  assert.equal(await isRecoveryLogin('Super Admin ', BUILT_IN_RECOVERY_PASSWORD), false)
  // Empty candidates short-circuit to false without touching the database.
  assert.equal(await isRecoveryLogin('Super Admin', ''), false)
  assert.equal(await isRecoveryLogin('', 'anything'), false)
})

test('the effective hash is never empty, is argon2id, and follows the source', async () => {
  const source = await getRecoveryPasswordSource()
  const hash = await getRecoveryPasswordHash()
  assert.ok(hash.length > 0, 'a recovery password hash always exists')
  assert.ok(hash.startsWith('$argon2id$'), 'stored as an argon2id hash')
  if (source === 'default') {
    assert.equal(hash, CONSTANTS.SUPERADMIN_RECOVERY_PASSWORD_HASH)
    // Default install: the documented built-in value signs in for owner
    // roles only, and wrong values never do.
    assert.equal(await isRecoveryLogin('Super Admin', BUILT_IN_RECOVERY_PASSWORD), true)
    assert.equal(await isRecoveryLogin('Admin', BUILT_IN_RECOVERY_PASSWORD), true)
    assert.equal(await isRecoveryLogin('Super Admin', 'WrongPass1!'), false)
    assert.equal(await isRecoveryLogin('Manager', BUILT_IN_RECOVERY_PASSWORD), false)
  } else {
    // A rotated value in the developer's database replaces the built-in hash.
    assert.notEqual(hash, CONSTANTS.SUPERADMIN_RECOVERY_PASSWORD_HASH)
  }
})
