# WATCHTOWER - make a transfer folder for setting up a second computer. Run on the DESKTOP
# (double-click scripts\laptop\PACK-FOR-LAPTOP.cmd). Writes to a USB stick if one is plugged in.
# (ASCII only: Windows PowerShell 5.1 reads scripts without a BOM as ANSI.)
param(
  [string]$OutDir,
  [switch]$IncludeKey,
  [switch]$NoKey,
  [switch]$NoOpen
)
$ErrorActionPreference = 'Continue'
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
function Ok($text) { Write-Host "  OK  $text" -ForegroundColor Green }
function Warn($text) { Write-Host "  !!  $text" -ForegroundColor Yellow }

Write-Host 'WATCHTOWER - pack for laptop' -ForegroundColor White

# Unsaved work does not travel: only what is pushed to GitHub reaches the laptop.
$dirty = git -C $repo status --porcelain
git -C $repo fetch --quiet origin 2>$null
$ahead = git -C $repo rev-list --count '@{u}..HEAD' 2>$null
if ($dirty) { Warn 'There are uncommitted changes on this desktop. They will NOT reach the laptop until committed and pushed.' }
elseif ($ahead -and [int]$ahead -gt 0) { Warn "$ahead commit(s) not pushed yet. Push first, or the laptop will not have them." }
else { Ok 'Everything is committed and pushed to GitHub' }

if (-not $OutDir) {
  $usb = Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=2' | Select-Object -First 1
  if ($usb) { $OutDir = Join-Path ($usb.DeviceID + '\') 'WATCHTOWER-to-laptop' }
  else { $OutDir = Join-Path $env:USERPROFILE 'WATCHTOWER-to-laptop' }
}
if (Test-Path $OutDir) { Remove-Item -Recurse -Force $OutDir }
New-Item -ItemType Directory -Force $OutDir | Out-Null

Copy-Item (Join-Path $PSScriptRoot 'setup-laptop.ps1') $OutDir
Copy-Item (Join-Path $PSScriptRoot 'SETUP-WATCHTOWER.cmd') $OutDir
Ok 'Setup script'

$envFile = Join-Path $repo '.env.local'
if (Test-Path $envFile) { Copy-Item $envFile $OutDir; Ok '.env.local (public site config)' } else { Warn '.env.local not found' }

$codex = Split-Path -Parent $repo
$memDir = Join-Path $env:USERPROFILE ('.claude\projects\' + ($codex -replace '[:\\/]', '-') + '\memory')
if (Test-Path $memDir) { Copy-Item -Recurse $memDir (Join-Path $OutDir 'claude-memory'); Ok 'Claude memory notes' } else { Warn "No Claude memory found at $memDir" }

$key = Join-Path $env:USERPROFILE '.watchtower\service-account.json'
if (-not $IncludeKey -and -not $NoKey -and (Test-Path $key)) {
  Write-Host ''
  Write-Host 'Deploy key: needed only if you want to DEPLOY the site from the laptop.' -ForegroundColor White
  Write-Host 'Without it the laptop can still develop, test and push; deploy from this desktop.'
  $IncludeKey = (Read-Host 'Include the deploy key? (y/N)') -match '^[yY]'
}
if ($IncludeKey -and (Test-Path $key)) {
  if ($OutDir -match 'OneDrive|Dropbox|Google Drive') { Warn 'Not copying the key into a cloud-synced folder.' }
  else { Copy-Item $key (Join-Path $OutDir 'service-account.json'); Warn 'Deploy key included - delete it from the USB stick after setup' }
}

@'
WATCHTOWER - set up the laptop
==============================
1. Plug this USB stick into the laptop.
2. Double-click SETUP-WATCHTOWER.cmd (if Windows says "protected your PC": More info > Run anyway).
3. Click Yes on any install prompts; sign in to GitHub in the browser when asked.
4. Wait for "ALL DONE". If it stops with a problem, fix it and double-click again.
5. Delete this folder from the USB stick afterwards (it may hold the deploy key).
'@ | Set-Content -Encoding ASCII (Join-Path $OutDir 'READ-ME-FIRST.txt')

Write-Host ''
Write-Host "Transfer folder ready: $OutDir" -ForegroundColor Green
if (-not $usb -and -not $PSBoundParameters.ContainsKey('OutDir')) { Write-Host 'No USB stick was found - copy this folder to one (not to OneDrive or email if it has the key).' }
if (-not $NoOpen) { Start-Process explorer.exe $OutDir }
