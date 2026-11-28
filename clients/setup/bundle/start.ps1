# AI The Route: Claude Code with your own subscription, Windows PowerShell 5.1+.
# start.cmd runs this file; the one-command install (install.ps1) does too. It
# copies itself to %USERPROFILE%\.aitheroute, finds Node.js 24.5+ or fetches
# the portable one from nodejs.org (checking the published SHA-256), and runs
# setup\core.mjs. Nothing needs administrator rights (only the optional leak
# guard's hosts part asks for them, setup\guard.mjs).

$ErrorActionPreference = 'Stop'
# Windows PowerShell's progress bar slows downloads down many times over.
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol =
  [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$here = $PSScriptRoot
$base = Join-Path $env:USERPROFILE '.aitheroute'
if (-not $env:AITR_LANG) { $env:AITR_LANG = if ((Get-UICulture).Name -like 'ru*') { 'ru' } else { 'en' } }
if (-not (Test-Path (Join-Path $here 'setup\core.mjs'))) {
  Write-Host 'AI The Route: setup\core.mjs is missing: unpack the whole archive.' -ForegroundColor Red; exit 1
}
# The repository's JSON has no byte order mark; 5.1 would read it in the ANSI code page.
$words = Get-Content -Raw -Encoding UTF8 (Join-Path $here "setup\$env:AITR_LANG.json") | ConvertFrom-Json
function Say($key) { Write-Host $words.$key }
function Fail($key) { Write-Host ('AI The Route: ' + $words.$key) -ForegroundColor Red; exit 1 }
function NodeOk {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { return $false }
  $v = (& node --version) -replace '^v', ''
  return ([version]$v -ge [version]'24.5.0')
}

New-Item -ItemType Directory -Force $base | Out-Null
if ((Resolve-Path $here).Path.TrimEnd('\') -ne (Resolve-Path $base).Path.TrimEnd('\')) {
  # Each part replaced whole, so a newer archive never leaves an older file behind.
  foreach ($item in 'README.md', 'start.sh', 'start.cmd', 'start.ps1', 'setup', 'helper') {
    $from = Join-Path $here $item
    if (-not (Test-Path $from)) { continue }
    $to = Join-Path $base $item
    try {
      if (Test-Path $to) { Remove-Item -Recurse -Force $to }
      Copy-Item -Recurse -Force $from $to
    } catch { Fail 'download' }
  }
}

$nodeDir = Join-Path $base 'node'
if (Test-Path (Join-Path $nodeDir 'node.exe')) { $env:Path = "$nodeDir;$env:Path" }
if (-not (NodeOk)) {
  $cpu = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
  Say 'node'
  $dist = 'https://nodejs.org/dist/latest-v24.x'
  # Beside node\, on the same drive: Move-Item cannot move a folder across drives.
  $tmp = Join-Path $base ('node-' + [guid]::NewGuid())
  New-Item -ItemType Directory -Force $tmp | Out-Null
  try {
    $sums = (Invoke-WebRequest -UseBasicParsing "$dist/SHASUMS256.txt").Content
    $file = [regex]::Match($sums, "node-v[\d.]+-win-$cpu\.zip").Value
    if (-not $file) { Fail 'os' }
    $want = [regex]::Match($sums, "([0-9a-f]{64})\s+$([regex]::Escape($file))").Groups[1].Value
    $zip = Join-Path $tmp $file
    Invoke-WebRequest -UseBasicParsing "$dist/$file" -OutFile $zip
    if ((Get-FileHash -Algorithm SHA256 $zip).Hash -ne $want.ToUpper()) { Fail 'checksum' }
    # tar.exe (Windows 10 1803+) unpacks Node's thousands of files far faster than Expand-Archive.
    # Windows' own bsdtar, not a GNU tar from Git that may come first on PATH and cannot read zip.
    $tar = Join-Path $env:SystemRoot 'System32\tar.exe'
    if (Test-Path $tar) { & $tar -xf $zip -C $tmp; if ($LASTEXITCODE -ne 0) { throw 'tar' } }
    else { Expand-Archive -Force $zip $tmp }
    if (Test-Path $nodeDir) { Remove-Item -Recurse -Force $nodeDir }
    Move-Item (Join-Path $tmp ($file -replace '\.zip$', '')) $nodeDir
  } catch { Fail 'download' } finally { Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue }
  $env:Path = "$nodeDir;$env:Path"
}
if (-not (NodeOk)) { Fail 'nodeFailed' }

# The leak guard by hand: start.cmd protect on|off|status (setup\guard.mjs).
if ($args.Count -gt 0 -and $args[0] -eq 'protect') {
  & node (Join-Path $base 'setup\protect.mjs') @($args | Select-Object -Skip 1)
  exit $LASTEXITCODE
}
& node (Join-Path $base 'setup\core.mjs')
exit $LASTEXITCODE
