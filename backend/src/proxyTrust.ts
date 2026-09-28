/**
 * Trust-proxy decision helper.
 *
 * Express's `trust proxy` setting makes `req.ip` come from X-Forwarded-For.
 * When the server is exposed directly (no reverse proxy), trusting that header
 * lets any client rotate their rate-limit key by sending fake headers and
 * bypass login throttling. So we only trust one hop when the operator opts in
 * via TRUST_PROXY=1|true (the deployed reverse-proxy setups for this app).
 *
 * Exports:
 * - resolveTrustProxy(env): pure resolver — 1 (one trusted hop), 0 (none), or a
 *   positive hop count for numeric TRUST_PROXY values.
 * - applyTrustProxy(app, env): applies it to an Express app and returns the
 *   resolved hop count.
 */
export function resolveTrustProxy(env: NodeJS.ProcessEnv): number {
  const raw = env.TRUST_PROXY
  if (raw === undefined || raw === '') return 0
  const t = raw.trim().toLowerCase()
  if (t === '1' || t === 'true') return 1
  if (t === '0' || t === 'false') return 0
  const n = Number(t)
  if (Number.isFinite(n) && n > 0) return Math.floor(n)
  return 0
}

export function applyTrustProxy(app: { set(name: string, value: unknown): void }, env: NodeJS.ProcessEnv): number {
  const hops = resolveTrustProxy(env)
  app.set('trust proxy', hops)
  return hops
}
