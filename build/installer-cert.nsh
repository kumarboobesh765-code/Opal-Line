; Runs after files are installed: import the code-signing certificate into the
; CURRENT USER's Root + TrustedPublisher stores so the freshly installed app
; shows a Valid Authenticode signature on machines that have never seen the
; cert before. certutil ships with Windows and -user needs no elevation.
!macro customInstall
  DetailPrint 'Trusting the Opal Line code-signing certificate for the current user...'
  SetOutPath $PLUGINSDIR
  File /oname=opal-line-signing.cer "${BUILD_RESOURCES_DIR}\signing-cert.cer"
  ExecWait 'cmd /c certutil -f -user -addstore Root "$PLUGINSDIR\opal-line-signing.cer" >nul 2>&1'
  ExecWait 'cmd /c certutil -f -user -addstore TrustedPublisher "$PLUGINSDIR\opal-line-signing.cer" >nul 2>&1'
  Delete "$PLUGINSDIR\opal-line-signing.cer"
!macroend
