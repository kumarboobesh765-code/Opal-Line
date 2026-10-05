# Opal Line Billing v1.0.11

A maintenance release that clears four long-held dependency majors. No new
features and no schema changes — this is about getting the app onto current,
supported versions of its core stack without changing behaviour.

## Upgrades

### express 4 → 5

The backend HTTP server moves to express 5.

**What this changes for you:** nothing visible. All existing routes, API
endpoints and integrations behave as before.

**One internal change worth knowing:** express 5 no longer supports the bare
`*` wildcard route, which this app used to serve the single-page frontend. The
route is now `/{*splat}` (`backend/src/index.ts`), which correctly serves the
app root `/` as well as every nested path.

### TypeScript 6 → 7

Compiler upgrade across the whole workspace, with no source changes.

The backend's module resolution moved from the legacy `node10` mode (removed in
TypeScript 7) to `bundler`. This matches how the code is actually built and run
— the packaged app bundles the backend with esbuild, and development uses tsx —
so nothing about the shipped output changes.

### Tailwind CSS 3 → 4

Styling engine upgrade, again with no intended visual change.

Tailwind 4 is configured in CSS rather than JavaScript. The design tokens that
used to live in `frontend/tailwind.config.js` now live in
`frontend/src/theme.css`. Colours, spacing, dark mode, animations and shadows
are unchanged.

The generated stylesheet is larger than before (roughly 60 KB → 92 KB). That is
expected: Tailwind 4 emits additional `@property` declarations so modern CSS
features can be used with correct fallbacks.

### dotenv 16 → 18

The library that loads the app's `.env` settings file is updated. The desktop
app stores its configuration in your user data folder and reloads it on every
start; this has been verified to behave identically, including saving settings
from the Settings screen and reading them back after a restart.

## Also included

- A developer guide (`docs/DEVELOPING.md`) covering local setup, the pre-commit
  secret guard, CI, and the release process.
- A nightly automated check that audits production dependencies for newly
  published security advisories — a CVE against a version already shipped is
  otherwise invisible until someone happens to push.
- A pre-commit guard that blocks accidentally committing credentials, plus a
  repository-wide scan (including git history) in CI.
- Dependabot configured for weekly, grouped update pull requests.

## Upgrading

Replace the installed application with the new installer. Your data, database,
settings and login are preserved; no migration or reconfiguration is required.

## Verifying

The release build is signed and its CI job installs the app into a clean Windows
environment, launches it, and runs the full interface test suite against the
installed copy — so the published installer is verified to start and work, not
merely to compile.