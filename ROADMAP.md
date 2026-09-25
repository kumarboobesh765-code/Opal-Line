# Roadmap

## v1.0.2 — planned scope

### Purchase invoice GST tracking (the last code TODO)

`backend/src/routes/dashboard.ts` GST reconciliation currently reports
`inputGst: 0` with a TODO. Purchase-side invoices carry GST amounts that are
never summed, so `netPayable` is overstated by the input credit.

Scope:

1. Confirm purchase invoices persist a `gstAmount`/`gst` (schema parity with
   sales invoices).
2. Sum GST over non-draft purchase invoices in the reconciliation endpoint
   and replace the `inputGst: 0` placeholder.
3. `netPayable = outputGst - inputGst` (floor at 0 negative-credit handling
   to be decided).
4. Add unit coverage for the reconciliation math, mirroring the existing
   pricing-engine tests.

### Auto-updater polish

- Surfaces a global in-app update banner (already shipping in this cycle).
- Log a successful "up-to-date" check once per app start instead of staying
  silent, so fresh installs show evidence the feed works.

### Release hygiene

- Ship the update banner in v1.0.2, then watch one real update cycle
  (1.0.1 → 1.0.2) end-to-end on a live machine before announcing.

### Deferred / ideas

- Live silver-rate provider hardening (retry/backoff tuning, rate-limited
  API fallback cache).
- PDF invoice branding options (logo, footer terms) exposed in Settings.
