// Importing rbac.ts transitively imports db/client.ts, which opens a PostgreSQL
// LISTEN connection at import time. That handle keeps this file's test process
// alive after the tests finish, so the backend test script runs with
// --test-force-exit. Do not call client.end() here instead: tearing the listen
// channel down raises an unhandled CONNECTION_DESTROYED rejection that the
// runner reports as a failed file even when every test passed.
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { MODULE_KEYS, defaultRolePermissions, emptyPermissions, mergePermissions } from './rbac'

describe('defaultRolePermissions', () => {
  test('the bootstrap Admin role can delete in every module, including system', () => {
    // Regression: Admin used to carry system.delete = false while the Users page
    // still rendered the Delete button, so deleting a user or a custom role was
    // impossible for the account that owns the install.
    const perms = defaultRolePermissions('Admin')
    for (const key of MODULE_KEYS) {
      assert.equal(perms[key].view, true, `${key}.view`)
      assert.equal(perms[key].create, true, `${key}.create`)
      assert.equal(perms[key].edit, true, `${key}.edit`)
      assert.equal(perms[key].delete, true, `${key}.delete`)
    }
  })

  test('Super Admin also has full access everywhere', () => {
    const perms = defaultRolePermissions('Super Admin')
    for (const key of MODULE_KEYS) {
      assert.equal(perms[key].delete, true, `${key}.delete`)
    }
  })

  test('an unknown role gets no permissions rather than a crash', () => {
    const perms = defaultRolePermissions('Does Not Exist')
    assert.deepEqual(perms, emptyPermissions())
  })
})

describe('mergePermissions', () => {
  test('a null override inherits the role defaults', () => {
    const role = defaultRolePermissions('Manager')
    const merged = mergePermissions(role, null)
    assert.deepEqual(merged, role)
  })

  test('an override only replaces the actions it names', () => {
    const role = defaultRolePermissions('Manager')
    const merged = mergePermissions(role, { system: { view: true, create: false, edit: false, delete: false } })
    // Manager has no system access by default, so the override grants exactly view.
    assert.equal(merged.system.view, true)
    assert.equal(merged.system.create, false)
    assert.equal(merged.system.edit, false)
    assert.equal(merged.system.delete, false)
    // Untouched modules keep the role's permissions.
    assert.deepEqual(merged.sales, role.sales)
  })

  test('a role default is never widened by an explicit false override', () => {
    const role = defaultRolePermissions('Admin')
    const merged = mergePermissions(role, { system: { view: true, create: true, edit: true, delete: false } })
    assert.equal(merged.system.delete, false)
  })
})
