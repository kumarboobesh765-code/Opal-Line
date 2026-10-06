# Buying and installing a CA code-signing certificate

Step-by-step companion to [Code signing and Windows SmartScreen](./signing-and-smartscreen.md).
That document explains *why* the current self-signed certificate makes Windows
show "Windows protected your PC"; this one is the shopping-and-installation
runbook to replace it.

## TL;DR checklist

1. Order an **OV code-signing certificate** from a public CA (prices below).
2. Pass **organization validation** (business documents + a phone callback).
3. Confirm the certificate **subject will contain the literal text
   `Opal Line Billing`** (see [Subject name](#subject-name-matter-for-this-repo)).
4. Receive a **USB token or cloud-HSM enrollment — not a .pfx file** (this is
   required by industry rules since 2023; see [Hardware delivery](#hardware-delivery-no-pfx)).
5. Install the token driver on the signing machine, insert the token, PIN.
6. Verify `Subject != Issuer` and run a signed build.
7. Choose a CI signing path (the repository's PFX secret flow needs one of the
   three options in [CI signing](#ci-signing-options)).
8. Publish the first release and let reputation build.

## What to buy

An **OV (Organization Validation) certificate** is the right choice here. EV
no longer grants instant SmartScreen reputation, so you would pay more for
nothing. Ballpark prices (October 2026 — verify at checkout, resellers
discount):

| CA / reseller route        | Ballpark price | Notes                                                        |
| -------------------------- | -------------- | ------------------------------------------------------------ |
| Certum (OpenPGP/Code)      | ~$70–130 / yr  | Cheapest; validation and support are slower                  |
| Sectigo (via reseller)     | ~$210–250 / yr | Common choice; orders are 1-year max since Feb 2026          |
| GlobalSign                 | ~$250–350 / yr | Mid-range, good validation tooling                           |
| DigiCert                   | ~$400–600 / yr | Fastest validation, best support, cloud signing (KeyLocker)  |

Other purchase facts to plan for:

- **Validity is now capped at ~15 months** (industry rule change effective
  March 2026), so budget for a renewal roughly every year and put it in the
  calendar — an expired signing certificate makes the next release unsigned.
- **Organization validation takes 1–5 business days.** Have the business
  registration certificate, GST/business registration number, and a reachable
  phone number ready — the CA calls the number listed in the official registry
  (not the one you type in the form) to confirm the request.
- Buy from the CA directly or from an established reseller (SSL2Buy, SSL
  Mentor, etc.). The certificate is identical; only price and support differ.

## Hardware delivery (no .pfx)

Since 2023, CA rules require code-signing private keys to be generated on
**hardware you cannot export the key from**: a USB token shipped by courier
(SafeNet eToken and similar), a smart card, or a **cloud HSM** the CA operates
(DigiCert KeyLocker, SSL.com eSigner). You will *not* receive a
`cert.pfx` you can double-click and upload to GitHub.

Consequences for this repository:

- **Local builds are unaffected** — electron-builder is configured
  (`certificateSubjectName: Opal Line Billing` in
  `electron/electron-builder.yml`) to pick the certificate out of
  `Cert:\CurrentUser\My` by subject name, and signtool talks to the token
  through its driver (you type the token PIN once per session). A hardware
  token works exactly like an imported PFX for local `npm run electron:build`.
- **The CI PFX secret flow needs one of the options in
  [CI signing options](#ci-signing-options).** `scripts/export-signing-pfx.ps1`
  cannot export a token-held key — exportable keys are precisely what the
  hardware rule outlawed.

## Subject name matters for this repo

Three places pin the signer identity to the product name. The certificate's
subject (the `CN=`/`O=` fields shown by `Get-AuthenticodeSignature`) must
contain the literal text `Opal Line Billing`:

| Pin                                  | What it checks                                      |
| ------------------------------------ | --------------------------------------------------- |
| `electron/electron-builder.yml`      | `signtoolOptions.certificateSubjectName` — the build **fails** if no matching cert is found |
| `electron/main.ts` (`verifyInstallerSignature`) | the auto-updater **rejects** a downloaded installer whose signer subject doesn't contain `Opal Line Billing` |
| `.github/workflows/release.yml`      | the release build **errors** if the imported certificate subject is unexpected |

Two ways to satisfy all three:

1. **Choose the subject at order time.** Some CAs let you specify the CN —
   request `CN=Opal Line Billing` (or any subject that *contains* that string).
   Zero code changes.
2. **If the CA forces the legal entity name** (e.g. `CN=Opal Line Jewels
   LLP`) and it doesn't contain `Opal Line Billing`, the three pins above must
   be updated to the new subject before the first signed release. This is a
   small, deliberate change — do it in the same PR as the certificate so the
   build, updater and release workflow all agree.

Whichever you pick, **verify before ordering** that the final subject will
contain the required text; changing it later means updating all three pins.

## Installing the token (Windows signing machine)

1. Install the vendor's driver first (SafeNet Authentication Client / eToken
   or the vendor's "Universal Windows Driver"; Certum uses its own PKCS#11
   tooling). Reboot if the installer asks.
2. Insert the token, note the PIN that arrived separately by mail/email.
3. Confirm Windows sees the certificate:

   ```powershell
   Get-ChildItem Cert:\CurrentUser\My |
     Where-Object { $_.Subject -like '*Opal Line Billing*' } |
     Format-List Subject, Issuer, NotAfter, Thumbprint
   ```

   `Issuer` must be the CA (e.g. `DigiCert Trusted G4…`, `Sectigo`,
   `Certum`) — **not** your own name. If `Subject` equals `Issuer`, you are
   still looking at the old self-signed certificate: move it out of the store
   so builds can't pick it by mistake.

4. Sign something small to confirm the driver + PIN path works:

   ```powershell
   signtool sign /sha1 <thumbprint> /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 .\some-test-file.exe
   signtool verify /pa /v .\some-test-file.exe
   ```

5. Build the app: `npm run electron:build`. electron-builder signs the app exe
   and the NSIS installer with that certificate and RFC 3161 timestamping.

## CI signing options

The repository currently signs in GitHub Actions from the
`WIN_SIGNING_PFX_B64` / `WIN_SIGNING_PFX_PASSWORD` secrets (see
`ci.yml` and `release.yml`). A hardware-held key changes that. Pick one:

| Option | How it works | Fits best with |
| ------ | ------------ | -------------- |
| **A. Cloud HSM signing** | The CA's cloud service plugs into the existing signtool flow (DigiCert KeyLocker ships a signtool CSP/Action; SSL.com eSigner similar). Secrets become an API key instead of a PFX. | Releases stay fully automated; DigiCert route |
| **B. Self-hosted runner** | A Windows machine with the token plugged in runs the release workflow; signtool reaches the token through the driver. | Teams with a always-on signing PC |
| **C. Sign locally, release from CI** | CI builds and uploads an unsigned artifact, or you run `npm run electron:build` locally with the token and attach the installer to the GitHub release. The `release.yml` signing steps skip when `WIN_SIGNING_PFX_B64` is absent (CI already tolerates this via `SIGNING_AVAILABLE`). | Certum/Sectigo (cheapest), low release cadence |

Whatever you choose, **never commit the token PIN, PFX or API key to the
repository** — only GitHub repository secrets (`gh secret set …`), and run
`npm run scan:secrets` before committing as usual.

## After the first CA-signed release

- **Expect the SmartScreen warning to persist at first.** Reputation accrues
  per publisher from real, clean downloads over days to weeks — the CA
  signature removes the "unknown/self-signed" treatment but does not grant an
  instant pass (EV doesn't either, since 2023).
- Optionally submit the installer to Microsoft for analysis to start the
  process sooner: <https://www.microsoft.com/wdsi/filesubmission>.
- Verify each release the way users' machines will:

  ```powershell
  signtool verify /pa /v .\dist\Opal.Line.Billing-Setup-*.exe
  ```

  `Subject` ≠ `Issuer`, chain status `OK`, timestamp present.
- The auto-updater validates the same properties before installing an update,
  so a certificate swap that breaks the subject pin would stop updates —
  double-check the pins in [Subject name](#subject-name-matter-for-this-repo)
  when the certificate changes.
