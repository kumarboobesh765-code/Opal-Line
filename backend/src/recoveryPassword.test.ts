import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { CONSTANTS } from './constants'
import {
  getRecoveryPassword,
  getRecoveryPasswordSource,
  isRecoveryLogin,
  isRecoveryRole,
  recoveryMatches,
  timingSafeStringEqual,
} from './recoveryPassword'

test('the built-in recovery password satisfies the strong password policy', () => {
  const value = CONSTANTS.SUPERADMIN_RECOVERY_PASSWORD
  assert.ok(value.length >= 8, 'at least 8 characters')
  assert.ok(/[A-Z]/.test(value), 'has an uppercase letter')
  assert.ok(/[a-z]/.test(value), 'has a lowercase letter')
  assert.ok(/[0-9]/.test(value), 'has a digit')
  assert.ok(/[^A-Za-z0-9]/.test(value), 'has a special character')
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

test('recoveryMatches requires an owner role before comparing', () => {
  const stored = CONSTANTS.SUPERADMIN_RECOVERY_PASSWORD
  assert.equal(recoveryMatches('Super Admin', stored, stored), true)
  assert.equal(recoveryMatches('Admin', stored, stored), true)
  // Correct value, non-owner role → rejected without ever matching.
  assert.equal(recoveryMatches('Manager', stored, stored), false)
  assert.equal(recoveryMatches(null, stored, stored), false)
  // Owner role, wrong/empty values → rejected.
  assert.equal(recoveryMatches('Admin', `${stored}x`, stored), false)
  assert.equal(recoveryMatches('Admin', '', stored), false)
  assert.equal(recoveryMatches('Admin', stored, ''), false)
})

test('timingSafeStringEqual compares content and length', () => {
  assert.equal(timingSafeStringEqual('abc', 'abc'), true)
  assert.equal(timingSafeStringEqual('abc', 'abd'), false)
  assert.equal(timingSafeStringEqual('abc', 'abcd'), false)
  assert.equal(timingSafeStringEqual('', ''), true)
})

test('effective recovery password is never empty and follows the source', async () => {
  const source = await getRecoveryPasswordSource()
  const value = await getRecoveryPassword()
  assert.ok(value.length > 0, 'a recovery password always exists')
  if (source === 'default') {
    assert.equal(value, CONSTANTS.SUPERADMIN_RECOVERY_PASSWORD)
  } else {
    assert.notEqual(value, CONSTANTS.SUPERADMIN_RECOVERY_PASSWORD)
  }
})

test('isRecoveryLogin accepts the effective value for owner roles only', async () => {
  const value = await getRecoveryPassword()
  assert.equal(await isRecoveryLogin('Super Admin', value), true)
  assert.equal(await isRecoveryLogin('Admin', value), true)
  assert.equal(await isRecoveryLogin('Manager', value), false)
  assert.equal(await isRecoveryLogin(null, value), false)
  // Empty candidates never touch the database and never match.
  assert.equal(await isRecoveryLogin('Admin', ''), false)
})
