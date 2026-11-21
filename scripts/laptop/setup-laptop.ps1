# WATCHTOWER - set up a second Windows computer for development.
# Run it by double-clicking SETUP-WATCHTOWER.cmd in the transfer folder made by PACK-FOR-LAPTOP.cmd.
# Safe to run again: every step skips what is already done.
# (ASCII only: Windows PowerShell 5.1 reads scripts without a BOM as ANSI.)
param(
  [string]$UserHome = $env:USERPROFILE,  # change only for testing
  [switch]$SkipTools,
  [switch]$SkipNpm,
  [switch]$SkipGitHub  # testing only
)
# Continue, not Stop: in Windows PowerShell 5.1 a native tool writing to stderr would abort the script.
$ErrorActionPreference = 'Continue'
$here = $PSScriptRoot
$failed = @()

function Step($text) { Write-Host ''; Write-Host "=== $text" -ForegroundColor Cyan }
function Ok($text) { Write-Host "    OK  $text" -ForegroundColor Green }
function Note($text) { Write-Host "    ..  $text" -ForegroundColor Gray }
function Bad($text) { Write-Host "    !!  $text" -ForegroundColor Red; $script:failed += $text }
function Have($cmd) { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }
function Update-SessionPath {
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}
function Install-WingetPackage($id, $label) {
  Note "Installing $label (a Windows prompt may ask for permission - click Yes)"
  winget install --id $id -e --source winget --accept-source-agreements --accept-package-agreements
  if ($LASTEXITCODE -ne 0) { Bad "Could not install $label (winget exit $LASTEXITCODE)" } else { Ok "$label installed" }
  Update-SessionPath
}
function Get-NodeMajor {
  if (-not (Have node)) { return 0 }
  $v = (node -v) -replace '^v', ''
  return [int]($v.Split('.')[0])
}

Write-Host 'WATCHTOWER laptop setup' -ForegroundColor White
Write-Host "Transfer folder: $here"

# 1. Tools ------------------------------------------------------------------------------------
Step '1/6  Tools: Git, GitHub CLI, Node.js 24+'
if ($SkipTools) { Note 'skipped (-SkipTools)' }
else {
  if (-not (Have winget)) {
    Bad 'winget is missing. Install "App Installer" from the Microsoft Store, then run this again.'
    exit 1
  }
  if (Have git) { Ok "Git $((git --version) -replace 'git version ', '')" } else { Install-WingetPackage 'Git.Git' 'Git' }
  if (Have gh) { Ok 'GitHub CLI present' } else { Install-WingetPackage 'GitHub.cli' 'GitHub CLI' }
  if ((Get-NodeMajor) -ge 24) { Ok "Node $(node -v)" } else { Install-WingetPackage 'OpenJS.NodeJS.LTS' 'Node.js LTS' }
  foreach ($c in 'git', 'gh', 'node', 'npm') {
    if (-not (Have $c)) { Bad "$c is still not found. Close this window, open a new one and run setup again." }
  }
  if ($failed.Count) { exit 1 }
  if ((Get-NodeMajor) -lt 24) { Bad "Node $(node -v) is too old; WATCHTOWER needs Node 24 or newer." }
}

# 2. GitHub sign-in ---------------------------------------------------------------------------
Step '2/6  GitHub sign-in'
if ($SkipGitHub) { Note 'skipped (-SkipGitHub)' } else {
gh auth status --hostname github.com *> $null
if ($LASTEXITCODE -eq 0) { Ok 'Already signed in to GitHub' }
else {
  Note 'A browser window will open. Sign in as bleclair003 and paste the code shown here.'
  gh auth login --hostname github.com --git-protocol https --web
  if ($LASTEXITCODE -ne 0) { Bad 'GitHub sign-in did not finish'; exit 1 }
  Ok 'Signed in'
}
gh auth setup-git *> $null
}

# 3. Code -------------------------------------------------------------------------------------
Step '3/6  Get the code'
$codex = Join-Path $UserHome 'Documents\Codex'
$repo = Join-Path $codex 'watchtower'
if (Test-Path (Join-Path $repo '.git')) {
  Note "Already cloned at $repo - pulling the latest"
  git -C $repo pull --ff-only
  if ($LASTEXITCODE -ne 0) { Bad 'git pull failed (local changes on this computer?). Fix that, then run again.' } else { Ok 'Up to date' }
}
else {
  New-Item -ItemType Directory -Force $codex | Out-Null
  gh repo clone bleclair003/watchtower $repo
  if ($LASTEXITCODE -ne 0) { Bad 'Clone failed'; exit 1 }
  Ok "Cloned to $repo"
}
# Commits from this computer use the GitHub no-reply address, never a real email (the repo is public).
git -C $repo config user.name 'SpookDog Studios'
git -C $repo config user.email '345373151+bleclair003@users.noreply.github.com'
Ok 'Commit identity set to the GitHub no-reply address'

# 4. Private files ----------------------------------------------------------------------------
Step '4/6  Private files from the transfer folder'
$envSrc = Join-Path $here '.env.local'
if (Test-Path $envSrc) { Copy-Item -Force $envSrc (Join-Path $repo '.env.local'); Ok '.env.local (site config for local runs)' }
else { Bad '.env.local is missing from the transfer folder - rerun PACK-FOR-LAPTOP.cmd on the desktop' }

$keySrc = Join-Path $here 'service-account.json'
if (Test-Path $keySrc) {
  $keyDir = Join-Path $UserHome '.watchtower'
  New-Item -ItemType Directory -Force $keyDir | Out-Null
  Copy-Item -Force $keySrc (Join-Path $keyDir 'service-account.json')
  Ok "Deploy key -> $keyDir\service-account.json"
}
else { Note 'No deploy key in the transfer folder: this computer can develop and push, but not deploy.' }

$memSrc = Join-Path $here 'claude-memory'
if (Test-Path $memSrc) {
  # Claude Code keeps memory per project folder, named after its path (":" and "\" become "-").
  $memDir = Join-Path $UserHome ('.claude\projects\' + ($codex -replace '[:\\/]', '-') + '\memory')
  New-Item -ItemType Directory -Force $memDir | Out-Null
  Copy-Item -Force -Recurse (Join-Path $memSrc '*') $memDir
  if (Test-Path (Join-Path $memDir 'MEMORY.md')) { Ok "Claude memory notes -> $memDir" }
  else { Bad "Claude memory notes did not copy to $memDir" }
}
else { Note 'No Claude memory notes in the transfer folder (optional).' }

# 5. Packages ---------------------------------------------------------------------------------
Step '5/6  Install packages (a few minutes)'
if ($SkipNpm) { Note 'skipped (-SkipNpm)' }
else {
  Push-Location $repo
  npm ci --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { Bad 'npm ci failed' } else { Ok 'Packages installed' }
  Pop-Location
}

# 6. Check ------------------------------------------------------------------------------------
Step '6/6  Check it works (unit tests + build)'
if ($SkipNpm) { Note 'skipped (-SkipNpm)' }
elseif ($failed.Count -eq 0) {
  Push-Location $repo
  npm test --silent
  if ($LASTEXITCODE -ne 0) { Bad 'Unit tests failed' } else { Ok 'Unit tests pass' }
  npm run build --silent
  if ($LASTEXITCODE -ne 0) { Bad 'Build failed' } else { Ok 'Build works' }
  Pop-Location
}

Write-Host ''
if ($failed.Count) {
  Write-Host 'SETUP FINISHED WITH PROBLEMS:' -ForegroundColor Red
  $failed | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
  Write-Host 'Fix those and double-click SETUP-WATCHTOWER.cmd again (it skips what is already done).'
}
else {
  Write-Host 'ALL DONE. This computer is ready.' -ForegroundColor Green
  Write-Host ''
  Write-Host "  Code:        $repo"
  Write-Host '  Next:        open Claude Code on that folder and say:'
  Write-Host '               "git pull, read docs/DEVELOPMENT_ROADMAP.md, then continue"'
  Write-Host '  Every time:  git pull before you start, push when you finish (Claude does this when asked).'
}
if (Test-Path $keySrc) {
  Write-Host ''
  Write-Host 'IMPORTANT: the deploy key is now installed. Delete it from the USB stick:' -ForegroundColor Yellow
  Write-Host "  $keySrc" -ForegroundColor Yellow
}
if ($failed.Count) { exit 1 }
