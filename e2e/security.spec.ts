import { expect, test } from '@playwright/test'

/**
 * Security regression suite for the Opal Line Billing backend.
 *
 * Anonymous checks run with an empty storage state; authenticated checks reuse
 * the shared admin session created by global-setup.
 */

// Endpoints that must never serve unauthenticated requests.
const PROTECTED_GET = [
  '/api/v1/auth/me',
  '/api/v1/system/status',
  '/api/v1/system/logs?file=app',
  '/api/v1/system/log-files',
  '/api/v1/env-config',
  '/api/v1/rbac/roles',
  '/api/v1/backup/scopes',
  '/api/v1/backup/files',
  '/api/v1/shopify/status',
  '/api/v1/settings/whatsapp-status',
  '/api/v1/db/silver-rates?limit=1',
  '/api/v1/db/dashboard/kpis',
]

test.describe('anonymous requests', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test('security headers are set on API responses', async ({ request }) => {
    const res = await request.get('/api/v1/health')
    expect(res.status()).toBe(200)
    const h = res.headers()
    expect(h['content-security-policy']).toContain("default-src 'self'")
    expect(h['x-content-type-options']).toBe('nosniff')
    expect(h['x-frame-options']).toBe('DENY')
    expect(h['referrer-policy']).toBe('strict-origin-when-cross-origin')
    expect(h['x-powered-by']).toBeUndefined()
    expect(h['strict-transport-security']).toContain('max-age=31536000')
  })

  test('CORS never grants access to foreign origins', async ({ request }) => {
    const res = await request.get('/api/v1/health', { headers: { Origin: 'https://evil.example' } })
    const acao = res.headers()['access-control-allow-origin']
    // The configured ACAO value is a fixed string; it must never echo or match
    // a foreign origin (which is what would actually grant a cross-origin read).
    expect(acao).not.toBe('https://evil.example')
    expect(acao).not.toBe('*')
  })

  test('protected endpoints reject unauthenticated access', async ({ request }) => {
    for (const path of PROTECTED_GET) {
      const res = await request.get(path)
      expect([401, 403], `${path} returned HTTP ${res.status()}`).toContain(res.status())
    }
  })

  test('state-changing requests without a CSRF token are rejected', async ({ request }) => {
    const res = await request.post('/api/v1/auth/logout', { data: {} })
    expect(res.status()).toBe(403)
    const body = (await res.json()) as { error?: string }
    expect(body.error ?? '').toMatch(/csrf/i)
  })

  test('Shopify webhook rejects unsigned payloads', async ({ request }) => {
    const res = await request.post('/api/v1/webhooks/shopify', {
      headers: { 'Content-Type': 'application/json' },
      data: { id: 123, title: 'orders/create' },
    })
    expect(res.status(), `unsigned webhook returned HTTP ${res.status()}`).not.toBe(200)
  })

  test('path traversal cannot read files outside the web roots', async ({ request }) => {
    const probes = [
      '/uploads/../../../windows/win.ini',
      '/uploads/..%2f..%2f..%2fwindows/win.ini',
      '/..%2f..%2fwindows/win.ini',
      '/assets/../../../windows/win.ini',
    ]
    for (const p of probes) {
      const res = await request.get(p)
      const text = await res.text()
      // win.ini marker text must never leak
      expect(text, `traversal probe leaked content: ${p}`).not.toContain('[fonts]')
      expect(text).not.toContain('for 16-bit app support')
    }
  })

  test('server secrets are never served statically', async ({ request }) => {
    for (const p of ['/.env', '/data/.env', '/.env.local', '/package.json', '/.git/config']) {
      const res = await request.get(p)
      const text = await res.text()
      expect(text, `${p} leaked sensitive content`).not.toContain('DATABASE_URL=')
      expect(text).not.toContain('.csrf-secret')
      if (res.status() === 200) {
        // only the SPA shell / assets are allowed to come back with 200
        expect(res.headers()['content-type'] ?? '').toContain('text/html')
      }
    }
  })

  test('malformed JSON fails cleanly without leaking stack traces', async ({ request }) => {
    const res = await request.post('/api/v1/auth/login', {
      headers: { 'Content-Type': 'application/json' },
      data: '{ this is not json',
    })
    expect([400, 415]).toContain(res.status())
    const text = await res.text()
    expect(text).not.toMatch(/\n\s+at\s+\w+/) // node stack frames
  })

  test('login responses advertise rate-limit policy', async ({ request }) => {
    const res = await request.post('/api/v1/auth/login', {
      data: { username: `e2e-probe-${Date.now()}`, password: 'definitely-wrong' },
    })
    expect(res.status()).toBe(401)
    const h = res.headers()
    expect(h['ratelimit-limit'] ?? h['ratelimit-policy'] ?? h['x-ratelimit-limit']).toBeTruthy()
  })

  test('repeated failed logins lock the account', async ({ request }) => {
    const data = { username: 'e2e-lockout-probe', password: 'definitely-wrong' }
    let last = 0
    for (let i = 0; i < 6; i++) {
      const res = await request.post('/api/v1/auth/login', { data })
      last = res.status()
    }
    // account lockout (5 failures / 15 min) or IP rate limit must kick in
    expect(last).toBe(429)
  })

  test('frontend bundle ships without source maps', async ({ request }) => {
    const html = await (await request.get('/')).text()
    const match = html.match(/src="(\/assets\/[^"]+\.js)"/)
    expect(match, 'no entry script found in index.html').toBeTruthy()
    const js = await (await request.get(match![1])).text()
    expect(js).not.toContain('sourceMappingURL')
  })
})

test.describe('authenticated requests', () => {
  test('session cookie is HttpOnly with SameSite=Strict', async ({ request }) => {
    const state = await request.storageState()
    const session = state.cookies.find((c) => c.name === 'opal.session')
    expect(session, 'session cookie missing — did global-setup log in?').toBeTruthy()
    expect(session!.httpOnly).toBe(true)
    expect(session!.sameSite).toBe('Strict')
  })

  test('env-config never returns raw secret values', async ({ request }) => {
    const res = await request.get('/api/v1/env-config')
    expect(res.status()).toBe(200)
    const body = (await res.json()) as {
      defs: Array<{ key: string; secret?: boolean }>
      values: Record<string, string>
    }
    for (const def of body.defs) {
      if (!def.secret) continue
      const value = body.values[def.key] ?? ''
      expect(value, `${def.key} leaked a raw secret`).not.toMatch(/^(shpat_|rzp_|sk-|re_|EAAG|xoxb-)/)
      if (value) expect(value.startsWith('•'), `${def.key} is not masked`).toBe(true)
    }
  })

  test('system status endpoint works and exposes no filesystem secrets', async ({ request }) => {
    const res = await request.get('/api/v1/system/status')
    expect(res.status()).toBe(200)
    const text = await res.text()
    expect(text).not.toContain('DATABASE_URL=')
    expect(text).not.toContain('password')
    const body = JSON.parse(text) as { ok: boolean; database: { healthy: boolean } }
    expect(body.ok).toBe(true)
    expect(body.database.healthy).toBe(true)
  })

  test('log viewer whitelists files (no traversal)', async ({ request }) => {
    const res = await request.get('/api/v1/system/logs?file=../../.env')
    expect(res.status()).toBe(400)
  })
})
