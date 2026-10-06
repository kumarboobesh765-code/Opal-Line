# Code signing and Windows SmartScreen

## The warning users see

> Windows protected your PC — Microsoft Defender SmartScreen prevented an
> unrecognized app from starting.
> App: Opal.Line.Billing-Setup-1.0.11.exe
> Publisher: Opal Line Billing

## Why it happens

The installer **is** signed. Verify it yourself:

```bash
export MSYS_NO_PATHCONV=1
"/c/Program Files (x86)/Windows Kits/10/bin/10.0.19041.0/x64/signtool.exe" \
  verify /pa /v "dist-electron/Opal Line Billing-Setup-1.0.11.exe"
```

It reports `Successfully verified` and an RFC 3161 timestamp from DigiCert. The
signature is intact.

The problem is who issued the certificate:

```
Subject : CN=Opal Line Billing
Issuer  : CN=Opal Line Billing     ← self-signed
```

Microsoft treats a self-signed certificate **identically to no signature at
all**. [SmartScreen reputation](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation)
requires a chain to a trusted public CA root. There is no code change, build
flag, or installer option that makes Windows trust a self-signed cert on a
machine that has never seen it — the trust has to come from the CA.

### What already helps, and what doesn't

`build/installer-cert.nsh` imports the cert into `Root` and `TrustedPublisher`
for the installing user, so the **installed app** shows a valid signature.

That runs *after* the download is already blocked, so it cannot prevent the
warning. It is still worth keeping.

## The fix

Buy a code-signing certificate from a public CA — DigiCert, Sectigo, or
GlobalSign — and replace the self-signed one. The full runbook — what to buy,
organization validation, hardware-token installation and the CI signing
options (since 2023 CAs ship tokens or cloud-HSM access, not .pfx files) — is
in [Buying and installing a CA code-signing certificate](./buy-a-code-signing-cert.md).

With a token-held certificate the local build needs no PFX at all
(`certificateSubjectName` finds it in the store); the commands below apply
when the key *is* exportable:

```powershell
# 1. Import the .pfx (only exists when the key is exportable — a hardware token has no .pfx).
Import-PfxCertificate -FilePath your-cert.pfx -Password $pw -CertStoreLocation Cert:\CurrentUser\My

# 2. Confirm it is CA-issued (Subject != Issuer).
Get-ChildItem Cert:\CurrentUser\My | Where-Object { $_.Subject -like '*Opal Line*' } |
  Format-List Subject, Issuer, NotAfter

# 3. Export for CI.
powershell -NoProfile -File scripts/export-signing-pfx.ps1
```

Then set `WIN_SIGNING_PFX_B64` (and `WIN_SIGNING_PFX_PASSWORD` if the PFX has
one) as repository secrets and rebuild.

### EV vs OV

EV certificates used to grant instant SmartScreen reputation. **They no longer
do.** Both OV and EV now build reputation from real downloads over days to
weeks, so an OV certificate is the cheaper choice unless you also need the
hardware-token requirement. Either way, expect the warning for the first
period of real-world distribution.

If you distribute through the Microsoft Store or winget, that reputation
problem largely goes away — those channels have their own trust paths.

## Automated guard

`.github/workflows/release.yml` now prints a loud warning when the signing
certificate is self-signed (`Subject == Issuer`). It warns rather than fails on
purpose: a self-signed installer still installs and runs, and blocking every
release until a CA certificate is purchased would be worse than a log line.
Once a CA-issued cert is in place the warning disappears.

## User-side workaround (until then)

If a user needs the app before SmartScreen reputation builds:

- Click **More info** → **Run anyway** on the warning dialog.
- Or right-click the installer → **Properties** → tick **Unblock** → **OK**.

Both are per-file and do not weaken the system.