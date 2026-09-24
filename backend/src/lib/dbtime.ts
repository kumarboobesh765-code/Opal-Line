/**
 * Parse a drizzle `timestamp` (without time zone) value back into a Date.
 *
 * The app writes UTC instants (new Date().toISOString()) and PostgreSQL drops
 * the zone marker, so the round-tripped string ("2026-09-24 11:16:31.745")
 * carries UTC clock values with NO offset. JavaScript parses zone-less strings
 * as LOCAL time, which on any non-UTC machine shifts the instant by the UTC
 * offset — e.g. in Asia/Kolkata every stored time looks 5 h 30 m in the past.
 * That made the login lockout window think each failure was hours old and
 * reset the counter on every attempt (lockout never triggered).
 *
 * Pin zone-less values back to UTC; pass through anything that already has a
 * zone designator.
 */
export function parseDbTimestamp(value: string | Date | null | undefined): Date | null {
  if (!value) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  const raw = String(value).trim()
  if (!raw) return null
  const hasZone = /(?:z|Z|[+-]\d{2}:?\d{2})$/.test(raw)
  const iso = hasZone ? raw.replace(' ', 'T') : `${raw.replace(' ', 'T')}Z`
  const parsed = new Date(iso)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}
