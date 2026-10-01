# Opal Line Billing — v1.0.8 Release Notes

> Maintenance release stacked on v1.0.7: CI hygiene and a fully lint-clean
> frontend. No application behavior changes.

## CI & Tooling

- **Release step runs on Node 24** — `softprops/action-gh-release` upgraded
  v2 → v3, so release builds no longer emit the
  "Node.js 20 is deprecated" annotation (v2.6.2 is the final v2 and runs on
  the deprecated runtime). (#47)
- **CI checks pinned to ubuntu-24.04** — ahead of GitHub's `ubuntu-latest`
  → Ubuntu 26 migration announced for October 19, 2026
  (actions/runner-images#14748), the checks job now runs on an explicit,
  stable image. (#47)
- **Zero oxlint warnings** — the frontend went from 44 warnings to 0. All
  `react(set-state-in-effect)` sites defer their first `load()` call with
  `queueMicrotask` so `setLoading(true)` fires after the effect body;
  `useMediaQuery` was rewritten on `useSyncExternalStore`; `Date.now()`
  calls moved out of render paths in the Payments dialog and the Business
  Reports aging buckets; `loadEmailStatus` is now declared above the effect
  that calls it. (#47)

## Verification (this release)

- Backend: 117/117 tests, `tsc --noEmit` clean.
- Frontend: oxlint 0 warnings / 0 errors, `tsc -b` + production build OK.
- E2E: full Playwright suite green against the installed app (desktop-e2e
  CI job on this tag), plus a local run against a freshly bootstrapped
  install — 46 passed / 7 skipped / 0 failed.
- Fresh-install verification on this machine: installer signature valid,
  bundled PostgreSQL bootstraps, first-run admin credentials generated and
  shown once, forced first password change works, API healthy afterwards.
