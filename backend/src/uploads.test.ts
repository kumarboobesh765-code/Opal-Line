import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { matchesImageMagic } from './uploads'

// Real format headers
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(20)])
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20)])
const GIF = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(20)])
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(20)])
const AVIF = Buffer.concat([Buffer.alloc(4), Buffer.from('ftypavif'), Buffer.alloc(20)])
// Hostile payloads pretending to be images
const HTML = Buffer.from('<!DOCTYPE html><script>alert(1)</script>')
const SVG = Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>')
const EXE = Buffer.concat([Buffer.from([0x4d, 0x5a]), Buffer.alloc(30)])

describe('matchesImageMagic', () => {
  test('accepts genuine formats', () => {
    assert.equal(matchesImageMagic(PNG, 'image/png'), true)
    assert.equal(matchesImageMagic(JPEG, 'image/jpeg'), true)
    assert.equal(matchesImageMagic(GIF, 'image/gif'), true)
    assert.equal(matchesImageMagic(WEBP, 'image/webp'), true)
    assert.equal(matchesImageMagic(AVIF, 'image/avif'), true)
  })

  test('rejects mismatched declarations (content vs mime)', () => {
    assert.equal(matchesImageMagic(HTML, 'image/png'), false)
    assert.equal(matchesImageMagic(SVG, 'image/png'), false)
    assert.equal(matchesImageMagic(EXE, 'image/jpeg'), false)
    assert.equal(matchesImageMagic(PNG, 'image/jpeg'), false)
  })

  test('rejects SVG smuggling via gif/webp claims', () => {
    assert.equal(matchesImageMagic(SVG, 'image/gif'), false)
    assert.equal(matchesImageMagic(HTML, 'image/webp'), false)
  })

  test('rejects truncated and empty payloads', () => {
    assert.equal(matchesImageMagic(Buffer.alloc(0), 'image/png'), false)
    assert.equal(matchesImageMagic(Buffer.from([0x89, 0x50]), 'image/png'), false)
  })

  test('rejects unknown mime types outright', () => {
    assert.equal(matchesImageMagic(PNG, 'image/svg+xml'), false)
    assert.equal(matchesImageMagic(PNG, 'text/html'), false)
  })
})
