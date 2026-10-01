# Opal Line Billing — Database Access & Manual Password Reset

Working procedures for connecting to the app's bundled PostgreSQL and changing
a user's password directly in the database (e.g. when the admin password is
lost). All commands below were verified against a fresh v1.0.8 install.

---

## 1. Where everything lives

| What | Path / value |
|---|---|
| PostgreSQL data directory | `%APPDATA%\Opal Line Billing\pgdata` (PostgreSQL **16**) |
| Bundled PG binaries (`psql.exe`, `pg_ctl.exe`) | `%LOCALAPPDATA%\Programs\Opal Line Billing\resources\pgsql\bin` |
| Server address | `127.0.0.1:47193` — **only listening while the app is running** |
| Database / user | `opal_line` / `postgres` |
| DB superuser password | `%APPDATA%\Opal Line Billing\.pg-password` (auto-generated per install — treat it as a secret) |
| First-run admin credentials (v1.0.9+) | `%APPDATA%\Opal Line Billing\Opal-First-Run-Credentials.txt` — written on first install and opened in Notepad automatically; older installs only showed the password once in a dialog |
| App logs | `%APPDATA%\Opal Line Billing\logs\app.log` |
| Backend API (health check) | `http://127.0.0.1:47192/api/v1/health` |

> **Prerequisite:** start the **Opal Line Billing app first** and wait for the
> main window. The embedded PostgreSQL only runs while the app is open —
> connecting from psql before that fails instantly with "connection refused".

---

## 2. Connecting with the bundled psql

### PowerShell (no password prompt)

```powershell
$env:PGPASSWORD = (Get-Content "$env:APPDATA\Opal Line Billing\.pg-password" -Raw).Trim(); & "$env:LOCALAPPDATA\Programs\Opal Line Billing\resources\pgsql\bin\psql.exe" -h 127.0.0.1 -p 47193 -U postgres -d opal_line
```

Note the **`;`** separating the two statements — without it PowerShell raises
a parse error (the `&` call operator cannot be glued to the previous command).

### cmd.exe (interactive password prompt)

```
"%LOCALAPPDATA%\Programs\Opal Line Billing\resources\pgsql\bin\psql.exe" -h 127.0.0.1 -p 47193 -U postgres -d opal_line
```

At `Password for user postgres:` paste the value from
`notepad "%APPDATA%\Opal Line Billing\.pg-password"` (right-click to paste in
the classic console; typing stays invisible — press Enter).

**Never launch psql.exe by double-clicking**: the console closes the moment it
errors, and you can't read why. Open cmd yourself first (`Win+R` → `cmd`).

### Git Bash

```bash
PGPASSWORD=$(tr -d '\r\n' < "$APPDATA/Opal Line Billing/.pg-password") \
"$LOCALAPPDATA/Programs/Opal Line Billing/resources/pgsql/bin/psql.exe" \
  -h 127.0.0.1 -p 47193 -U postgres -d opal_line
```

You are connected when the prompt reads `opal_line=#`.

Sanity checks once inside:

```sql
\conninfo                                   -- confirms db, user, host, port
SELECT username, role, status FROM users;   -- list app users
```

---

## 3. Resetting an app-user password manually

### Step 1 — generate an argon2id hash for the new password

From the project repo (uses the same argon2 library as the backend):

```bash
cd backend
node -e "require('argon2').hash('YourNew@Pass123').then(console.log)"
```

Copy the full output, which looks like:

```
$argon2id$v=19$m=65536,p=4,t=3$<salt>$<hash>
```

### Step 2 — update the user row

In the psql session (**one line, must end with `;`** — the semicolon is what
executes it):

```sql
UPDATE users SET password_hash = 'PASTE_YOUR_ARGON2_HASH_HERE', require_password_change = false WHERE username = 'admin';
```

Success looks like: `UPDATE 1`.

Replace `admin` with any username from `SELECT username FROM users;`.
Keep the hash inside single quotes; double any `'` that appears inside it
(argon2 hashes contain none, so this is rarely needed).

### Step 3 — verify

```sql
SELECT username, left(password_hash, 20) FROM users;
```

Then log in through the app with the new password.

### Optional: force a password change at next login

```sql
UPDATE users SET require_password_change = true WHERE username = 'admin';
```

The app will route that user to the change-password screen after the next
successful login.

---

## 4. Changing the PostgreSQL role password (advanced)

The `.pg-password` file stores the **PostgreSQL superuser** password (SCRAM —
PG hashes it itself; no argon2 involved). To change it, do **both** parts or
the app will no longer start its database:

```sql
ALTER USER postgres WITH PASSWORD 'NewDbPass123!';
\q
```

```powershell
Set-Content -Path "$env:APPDATA\Opal Line Billing\.pg-password" -Value 'NewDbPass123!' -NoNewline
```

---

## 5. Argon2 configuration used by the backend

| Parameter | Value |
|---|---|
| Library | node-argon2 (`argon2`) **0.45.1** |
| Variant | **argon2id** |
| Version | `19` (spec v1.3) |
| memoryCost | **65536 KiB (64 MiB)** — `m=65536` |
| timeCost | **3** — `t=3` |
| parallelism | **4** — `p=4` |
| Salt | 16 random bytes per hash |
| Hash length | 32 bytes |

These are the node-argon2 defaults; the parameters are embedded in every hash
string, so `argon2.verify` accepts a hand-generated hash even with different
costs — but generating with the repo's library (Step 1) keeps everything
consistent.

---

## 6. Troubleshooting

| Symptom | Cause & fix |
|---|---|
| psql window flashes and closes instantly | App not running (nothing on 47193), or psql double-clicked. Start the app, then run psql from an **open** cmd window. |
| `Password for user postgres:` never appears | Connection failed before auth (app not running / wrong port). Check `netstat -ano | findstr 47193` while the app is open. |
| `password authentication failed` | `.pg-password` doesn't match the database (e.g. role password changed without updating the file). Redo section 4 (both parts). |
| Prompt shows `opal_line-#` instead of `opal_line=#` | Previous statement is unfinished (missing `;` or an unbalanced quote). Press **Ctrl+C** to cancel and retype. |
| Prompt shows `'>` or `">` | Unbalanced quote in the pasted statement — Ctrl+C and retype. |
| `UPDATE 0` | Username doesn't match — check `SELECT username FROM users;` (case-sensitive). |
| PowerShell error on the connect one-liner | The two statements were pasted as one line without the `;` separator. |
| Nothing works / DB won't start | Inspect `%APPDATA%\Opal Line Billing\logs\app.log`. **Never kill `postgres.exe` directly** — always close the app normally, or use `pg_ctl stop -m fast -D "%APPDATA%\Opal Line Billing\pgdata"` (a forced kill leaves a stale `postmaster.pid` that blocks the next start). |
