import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { parseCsvContent } from './orderEmailIngest'

// Importing these modules transitively imports db/client.ts, which opens a
// PostgreSQL LISTEN connection at import time. That handle keeps this file's
// test process alive after the tests finish, so the backend test script runs
// with --test-force-exit. Do not call client.end() here instead: tearing the
// listen channel down raises an unhandled CONNECTION_DESTROYED rejection that
// the runner reports as a failed file even when every test passed.

describe('parseCsvContent (customer export watcher)', () => {
  test('parses Shopify-style headers with quoted fields containing commas', () => {
    const csv = [
      '"First Name","Last Name","Email","Default Address Address1","Default Address City"',
      '"Meera","Nair","meera@example.com","8 Marine Drive, Near Gateway","Mumbai"',
    ].join('\r\n')
    const rows = parseCsvContent(csv)
    assert.equal(rows.length, 1)
    assert.equal(rows[0]['First Name'], 'Meera')
    assert.equal(rows[0]['Email'], 'meera@example.com')
    assert.equal(rows[0]['Default Address Address1'], '8 Marine Drive, Near Gateway')
    assert.equal(rows[0]['Default Address City'], 'Mumbai')
  })

  test('handles escaped quotes and blank fields', () => {
    const csv = [
      'First Name,Last Name,Email,Note',
      'Ajit,h,"ajit@example.com","said ""hi"", left"',
    ].join('\n')
    const rows = parseCsvContent(csv)
    assert.equal(rows[0]['Note'], 'said "hi", left')
    assert.equal(rows[0]['Email'], 'ajit@example.com')
  })

  test('skips empty lines and returns [] for header-only input', () => {
    assert.deepEqual(parseCsvContent('A,B\n'), [])
    assert.deepEqual(parseCsvContent(''), [])
  })
})
