<#
.SYNOPSIS
  Bloop: remove the copy that scripts\install.ps1 installed for this Windows user.

.DESCRIPTION
  Removes %LOCALAPPDATA%\Programs\Bloop, the Start menu and Desktop shortcuts, the
  Settings > Apps entry and the launch-at-login entry, then asks before deleting your data
  (%APPDATA%\bloop: settings, history, logs).

    powershell -ExecutionPolicy Bypass -File scripts\uninstall.ps1
    powershell -ExecutionPolicy Bypass -File scripts\uninstall.ps1 -KeepData
    powershell -ExecutionPolicy Bypass -File scripts\uninstall.ps1 -Purge

.PARAMETER KeepData  Keep settings, history and logs.
.PARAMETER Purge     Delete that data too, without asking.
#>
[CmdletBinding()]
param(
  [switch]$KeepData,
  [switch]$Purge
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$InstallDir = Join-Path $env:LOCALAPPDATA 'Programs\Bloop'
$UninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\BloopFromSource'
$DataDir = Join-Path $env:APPDATA 'bloop'

function Write-Ok([string]$Text)   { Write-Host "  + $Text" -ForegroundColor Green }
function Write-Info([string]$Text) { Write-Host "    $Text" }
function Write-Warn([string]$Text) { Write-Host "  ! $Text" -ForegroundColor Yellow }

function Remove-IfExists([string]$Path) {
  if (Test-Path -LiteralPath $Path) {
    Remove-Item -LiteralPath $Path -Recurse -Force
    Write-Ok "removed $Path"
  }
}

function Get-FolderSize([string]$Path) {
  $sum = (Get-ChildItem -LiteralPath $Path -Recurse -File -Force -ErrorAction SilentlyContinue |
    Measure-Object -Property Length -Sum).Sum
  if (-not $sum) { return '0 MB' }
  return ('{0:N0} MB' -f ($sum / 1MB))
}

Write-Host 'Removing Bloop' -ForegroundColor White

# Quit it (the tray app has no window to close, so stop the process).
$procs = @(Get-Process -Name 'Bloop' -ErrorAction SilentlyContinue)
if ($procs.Count -gt 0) {
  Write-Info 'Quitting Bloop...'
  $procs | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 1
}

# The script may be running from inside the install folder (Settings > Apps > Uninstall);
# PowerShell has already read it, so deleting the folder is fine. Step out of it first.
Set-Location $env:TEMP
$envFile = Join-Path $InstallDir '.env'
if (Test-Path -LiteralPath $envFile) {
  Get-ChildItem -LiteralPath $InstallDir -Force | Where-Object { $_.Name -ne '.env' } | Remove-Item -Recurse -Force
  Write-Ok "removed Bloop from $InstallDir"
  Write-Warn "Kept $envFile (your API key file). Delete it yourself if you don't need it."
} else {
  Remove-IfExists $InstallDir
}
Remove-IfExists (Join-Path ([Environment]::GetFolderPath('Programs')) 'Bloop.lnk')
Remove-IfExists (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Bloop.lnk')
Remove-IfExists $UninstallKey

# "Open Bloop when you log in" (Electron writes a Run value named after the AppUserModelId / exe).
$run = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
foreach ($name in @('edu.bloop.app', 'Bloop', 'bloop')) {
  if (Get-ItemProperty -Path $run -Name $name -ErrorAction SilentlyContinue) {
    Remove-ItemProperty -Path $run -Name $name -ErrorAction SilentlyContinue
    Write-Ok "removed login item '$name'"
  }
}
Write-Ok 'Bloop app removed'

if (-not (Test-Path -LiteralPath $DataDir)) {
  Write-Host ''
  Write-Host 'Done. No Bloop data was found.' -ForegroundColor Green
  exit 0
}

Write-Host ''
Write-Host 'Your Bloop data (settings, session history, logs):'
Write-Info "$DataDir  ($(Get-FolderSize $DataDir))"

$wipe = $false
if ($Purge) {
  $wipe = $true
} elseif (-not $KeepData) {
  $interactive = $false
  try { $interactive = [Environment]::UserInteractive -and -not [Console]::IsInputRedirected } catch { }
  if ($interactive) {
    $reply = Read-Host "  Delete your Bloop data too? This can't be undone. [y/N]"
    $wipe = ($reply -match '^(y|yes)$')
  }
}

Write-Host ''
if ($wipe) {
  Remove-IfExists $DataDir
  Write-Host 'Done. Bloop and its data are gone.' -ForegroundColor Green
} else {
  Write-Host 'Done. Your data was kept; reinstalling Bloop picks it up again.' -ForegroundColor Green
}
