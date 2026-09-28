import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { filterAttachableFiles, MAX_TOTAL_ATTACHMENT_MB, MAX_SINGLE_ATTACHMENT_MB } from './mailAttachments'

const mb = (n: number): Buffer => Buffer.alloc(n * 1024 * 1024)

describe('filterAttachableFiles', () => {
  test('keeps a small file', () => {
    const r = filterAttachableFiles([{ fileName: 'a.json', content: mb(1) }])
    assert.equal(r.attachable.length, 1)
    assert.deepEqual(r.skipped, [])
    assert.equal(r.totalMb, 1)
  })

  test('drops a single file over the per-file limit', () => {
    const r = filterAttachableFiles([{ fileName: 'huge.json', content: mb(MAX_SINGLE_ATTACHMENT_MB + 1) }])
    assert.equal(r.attachable.length, 0)
    assert.equal(r.skipped.length, 1)
    assert.match(r.skipped[0].reason, /per-file limit/)
  })

  test('stops adding files once the total budget is reached, keeping earlier ones', () => {
    const files = [
      { fileName: 'a.json', content: mb(9) },
      { fileName: 'b.json', content: mb(9) },
      { fileName: 'c.json', content: mb(9) },
    ]
    const r = filterAttachableFiles(files)
    // a + b = 18 MB fits; c would push to 27 MB → skipped
    assert.deepEqual(r.attachable.map((f) => f.fileName), ['a.json', 'b.json'])
    assert.equal(r.skipped.length, 1)
    assert.match(r.skipped[0].reason, /total attachment budget/)
    assert.equal(r.totalMb, 18)
  })

  test('reports multiple skips and an empty result when nothing fits', () => {
    const r = filterAttachableFiles([
      { fileName: 'big1.json', content: mb(30) },
      { fileName: 'big2.json', content: mb(22) },
    ])
    assert.equal(r.attachable.length, 0)
    assert.equal(r.skipped.length, 2)
    assert.equal(r.totalMb, 0)
  })

  test('handles an empty file list', () => {
    const r = filterAttachableFiles([])
    assert.equal(r.attachable.length, 0)
    assert.equal(r.skipped.length, 0)
    assert.equal(r.totalMb, 0)
  })
})
