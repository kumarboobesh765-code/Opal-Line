import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { sanitizeProductDescription, toDescriptionHtml } from '../src/shopify'

describe('sanitizeProductDescription', () => {
  test('keeps allowlisted formatting tags', () => {
    const html = '<p>Sterling silver <b>ring</b> with <em>polish</em></p><ul><li>92.5% pure</li></ul>'
    assert.equal(sanitizeProductDescription(html), html)
  })

  test('strips script and style blocks entirely', () => {
    const dirty = '<p>Fine silver</p><script>alert(1)</script><style>.x{}</style>'
    assert.equal(sanitizeProductDescription(dirty), '<p>Fine silver</p>')
  })

  test('removes event handlers and javascript: URLs from kept tags', () => {
    const dirty = '<p onclick="alert(1)">Link <a href="javascript:evil()">x</a></p>'
    const out = sanitizeProductDescription(dirty)
    assert.ok(!out.includes('onclick'))
    assert.ok(!out.includes('javascript:'))
    // <a> is not allowlisted — the tag itself goes too
    assert.ok(!out.includes('<a'))
  })

  test('drops non-allowlisted tags like iframe and img', () => {
    const out = sanitizeProductDescription('<p>a</p><iframe src="https://x"></iframe><img src="https://x">')
    assert.equal(out, '<p>a</p>')
  })
})

describe('toDescriptionHtml', () => {
  test('plain text becomes paragraphs with escaped entities', () => {
    const out = toDescriptionHtml('Line one\n\nLine two <b>safe</b>', 'Ring')
    assert.equal(out, '<p>Line one</p><p>Line two &lt;b&gt;safe&lt;/b&gt;</p>')
  })

  test('falls back to the name paragraph when empty', () => {
    assert.equal(toDescriptionHtml(null, 'Silver Ring'), '<p>Silver Ring</p>')
    assert.equal(toDescriptionHtml('   ', 'Silver Ring'), '<p>Silver Ring</p>')
  })

  test('sanitized html passes through when tags are present', () => {
    const out = toDescriptionHtml('<p>Real <strong>HTML</strong><script>x()</script></p>', 'Ring')
    assert.equal(out, '<p>Real <strong>HTML</strong></p>')
  })
})
