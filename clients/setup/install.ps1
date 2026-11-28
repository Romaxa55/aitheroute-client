# AI The Route: Claude Code in one command, Windows PowerShell 5.1+.
#   irm https://<gateway>/i/<token>/win | iex
# The gateway fills in its origin, the token and the messages below. This
# stage only fetches the setup archive (the same one the bot offers to
# download) into a temporary folder and runs its start.ps1, which copies it to
# %USERPROFILE%\.aitheroute and does the rest. Nothing needs administrator rights
# (only the optional leak guard's hosts part asks for them, setup\guard.mjs).

& {
  # Inside the block, so the token is gone from the person's session afterwards.
#@@VARS@@
  # Run through iex: `exit` would close the person's window, so each stop returns.
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue'
  [Net.ServicePointManager]::SecurityProtocol =
    [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
  function Stop($text) { Write-Host "AI The Route: $text" -ForegroundColor Red }

  if ($AITR_STOP) { Stop $AITR_STOP; return }
  Write-Host $M_core
  $tmp = Join-Path $env:TEMP ('aitr-' + [guid]::NewGuid())
  New-Item -ItemType Directory -Force $tmp | Out-Null
  try {
    try {
      $zip = Join-Path $tmp 'aitheroute.zip'
      Invoke-WebRequest -UseBasicParsing "$AITR_ORIGIN/setup/aitheroute.zip" -OutFile $zip
      Expand-Archive -Force $zip $tmp
    } catch { Stop $M_download; return }
    $env:AITR_ORIGIN = $AITR_ORIGIN
    $env:AITR_TOKEN = $AITR_TOKEN
    $env:AITR_LANG = $AITR_LANG
    # A child PowerShell: a script file runs there even where the policy blocks .ps1 files.
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $tmp 'aitheroute\start.ps1')
  } finally {
    Remove-Item Env:\AITR_TOKEN -ErrorAction SilentlyContinue
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
  }
}
