# Superadmin recovery password

If the owner forgets their Opal Line login password, the **recovery password**
can be typed into the normal **Password** box on the Sign-in screen — it works
as the password itself.

## Built-in default

```
OpalLine-SuperAdmin-2026
```

- Identical on every install (deliberate: the value is stable, so it is always
  available even when the database or the machine is the only thing you have).
- Defined in one place: `CONSTANTS.SUPERADMIN_RECOVERY_PASSWORD`
  (`backend/src/constants.ts`).

## Rules

- **Owner roles only.** It signs in `Admin` and `Super Admin` accounts; every
  other role is rejected before any comparison happens.
- **Lockout still applies.** Wrong guesses count towards the 5-failures /
  15-minute lockout and are recorded as failed login attempts.
- **Fully audited.** Every successful use writes a `Recovery Login Used`
  activity-log entry with the account, role and IP.
- **Closes the loop.** After signing in with it, the same value is accepted as
  the "current password" in Settings → Change password, so a forgotten login
  password can be replaced end to end.

## Rotation

Settings → **Team** → **Recovery password** (Admin / Super Admin only):

- **Save new value** — stores a custom password (must satisfy the strong
  password policy: 8+ chars, upper, lower, digit, symbol). It is stored
  **encrypted** (AES-256-GCM under the app's master key) in the settings row —
  never in plain text, and never returned by the generic settings API.
- **Reset to built-in default** — discards the custom value and reactivates
  the shipped default.

The current effective value is shown only to Admin / Super Admin sessions.

## Security note

Because the default is fixed, anyone who reads the source code or this
document knows it. That is an accepted trade-off for a recoverable owner
account on a desktop-only deployment (the API binds to `127.0.0.1`), and the
reason rotation to a private value exists: **rotate it after install if the
machine is shared or the app is exposed beyond localhost.**
