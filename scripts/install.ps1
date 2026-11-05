<#
.SYNOPSIS
  Bloop: build the app from this source folder and install it for the current Windows user.

.DESCRIPTION
  Builds Bloop on this PC (npm ci, type check, electron-vite, electron-builder --win dir), copies it to
  %LOCALAPPDATA%\Programs\Bloop, adds Start menu (and Desktop) shortcuts, registers it under
  Settings > Apps, and starts it. No administrator rights needed.

  Re-running it updates Bloop: it pulls the latest code (when the checkout is clean), rebuilds and
  replaces the installed copy. Your settings and history in %APPDATA%\bloop are kept.

  It also downloads the on-device Bloop model (about 532 MB, checked against its sha256) to
  %APPDATA%\bloop\models while the app builds, so there is no wait later. The model stays OFF until
  you choose "Use Bloop model" in Settings > AI. Pass -NoModel to skip it. A failed download never
  fails the install; re-running resumes it.

  Run it with:
    powershell -ExecutionPolicy Bypass -File scripts\install.ps1
  or, from the source folder:
    npm run install-app:win

.PARAMETER NoLaunch           Install but don't start Bloop afterwards.
.PARAMETER Fast               Skip the TypeScript check.
.PARAMETER Clean              Delete dist, out and node_modules first (fixes most odd build errors).
.PARAMETER NoPull             Don't `git pull` the latest code first.
.PARAMETER KeepBuild          Keep the build output in dist\ (deleted after installing by default).
.PARAMETER NoDesktopShortcut  Don't create a Desktop shortcut.
.PARAMETER NoModel            Don't download the on-device Bloop model (532 MB; do it later in Settings > AI).
.PARAMETER ModelOnly          Only download and verify the Bloop model, then stop (no build, no install).
#>
[CmdletBinding()]
param(
  [switch]$NoLaunch,
  [switch]$Fast,
  [switch]$Clean,
  [switch]$NoPull,
  [switch]$KeepBuild,
  [switch]$NoDesktopShortcut,
  [switch]$NoModel,
  [switch]$ModelOnly
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # Remove-Item/Copy-Item progress bars are very slow in PS 5

$AppId = 'edu.bloop.app'                   # = build.appId; the app sets the same AppUserModelId
$NodeMin = 20
$Root = Split-Path -Parent $PSScriptRoot
$InstallDir = Join-Path $env:LOCALAPPDATA 'Programs\Bloop'
$UninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\BloopFromSource'
$script:StepNo = 0
$script:ModelProc = $null
$script:ModelCtx = $null
# The switches this run was started with, to pass on if the script re-launches itself after a pull.
$ScriptSwitches = @($PSBoundParameters.GetEnumerator() | Where-Object { $_.Key -ne 'NoPull' -and $_.Value } | ForEach-Object { "-$($_.Key)" })

# ------------------------------------------------------------------ output helpers

function Write-Step([string]$Text) {
  $script:StepNo++
  Write-Host ''
  Write-Host ("==> [{0}] {1}" -f $script:StepNo, $Text) -ForegroundColor Cyan
}
function Write-Ok([string]$Text)   { Write-Host "    + $Text" -ForegroundColor Green }
function Write-Info([string]$Text) { Write-Host "    $Text" }
function Write-Warn([string]$Text) { Write-Host "    ! $Text" -ForegroundColor Yellow }
function Stop-Install([string]$Text) {
  Write-Host ''
  Write-Host "Error: $Text" -ForegroundColor Red
  exit 1
}

function Test-Interactive {
  try { return [Environment]::UserInteractive -and -not [Console]::IsInputRedirected } catch { return $false }
}

# y/N question; "no" when nobody can answer.
function Confirm-Choice([string]$Question) {
  if (-not (Test-Interactive)) { return $false }
  $reply = Read-Host "    $Question [y/N]"
  return ($reply -match '^(y|yes)$')
}

# Run a native command and stop if it fails. Its output goes straight to the console.
function Invoke-Native([string]$Exe, [string[]]$Arguments) {
  & $Exe @Arguments
  if ($LASTEXITCODE -ne 0) { Stop-Install "'$Exe $($Arguments -join ' ')' failed (exit code $LASTEXITCODE)." }
}

# Run a native command quietly and return its trimmed stdout, or $null if it failed.
# (In Windows PowerShell 5, stderr from a native command becomes a terminating error when
# $ErrorActionPreference is Stop, so relax it for the call.)
function Get-NativeOutput([string]$Exe, [string[]]$Arguments) {
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $out = & $Exe @Arguments 2>$null
    if ($LASTEXITCODE -ne 0) { return $null }
    return (($out | Out-String).Trim())
  } catch {
    return $null
  } finally {
    $ErrorActionPreference = $prev
  }
}

function Test-Command([string]$Name) { return [bool](Get-Command $Name -ErrorAction SilentlyContinue) }

function Update-PathFromRegistry {
  $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $user = [Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = ($machine, $user | Where-Object { $_ }) -join ';'
}

function Install-WithWinget([string]$Id, [string]$Label) {
  if (-not (Test-Command 'winget')) { return $false }
  if (-not (Confirm-Choice "Install $Label now with 'winget install $Id'?")) { return $false }
  & winget install --exact --id $Id --accept-source-agreements --accept-package-agreements | Out-Host
  Update-PathFromRegistry
  return $true
}

# ------------------------------------------------------------------ checks

function Get-NodeMajor {
  $v = Get-NativeOutput 'node' @('-p', 'process.versions.node.split(''.'')[0]')
  if ($v -match '^\d+$') { return [int]$v }
  return 0
}

function Test-Tools {
  Write-Step 'Checking tools'

  if (-not (Test-Command 'git')) {
    Write-Warn 'git is missing.'
    [void](Install-WithWinget 'Git.Git' 'Git')
    if (-not (Test-Command 'git')) {
      if (Test-Path (Join-Path $Root '.git')) {
        Stop-Install 'Install Git (https://git-scm.com/download/win or: winget install Git.Git), open a new PowerShell window and run this again.'
      }
    }
  }
  if (Test-Command 'git') { Write-Ok (Get-NativeOutput 'git' @('--version')) }

  if ((-not (Test-Command 'node')) -or ((Get-NodeMajor) -lt $NodeMin)) {
    if (Test-Command 'node') { Write-Warn ("Found Node.js " + (Get-NativeOutput 'node' @('-v')) + ", which is too old.") }
    Write-Warn "Bloop needs Node.js $NodeMin or newer to build."
    [void](Install-WithWinget 'OpenJS.NodeJS.LTS' 'Node.js LTS')
    if ((-not (Test-Command 'node')) -or ((Get-NodeMajor) -lt $NodeMin)) {
      Write-Info 'Install the LTS version from https://nodejs.org (or: winget install OpenJS.NodeJS.LTS),'
      Stop-Install "then open a NEW PowerShell window and run this again."
    }
  }
  if (-not (Test-Command 'npm.cmd')) { Stop-Install "npm is missing (it normally comes with Node.js). Reinstall Node.js $NodeMin+." }
  Write-Ok ("node " + (Get-NativeOutput 'node' @('-v')) + ", npm " + (Get-NativeOutput 'npm.cmd' @('-v')))

  $script:NodeArch = Get-NativeOutput 'node' @('-p', 'process.arch')
  if ($script:NodeArch -notin @('x64', 'arm64')) { Stop-Install "Unsupported Node.js architecture '$($script:NodeArch)'. Install the 64-bit Node.js." }

  $machineArch = $env:PROCESSOR_ARCHITEW6432
  if (-not $machineArch) { $machineArch = $env:PROCESSOR_ARCHITECTURE }
  if ($machineArch -eq 'ARM64') {
    if ($script:NodeArch -eq 'arm64') {
      Write-Warn 'Windows on ARM with arm64 Node.js: building a native arm64 Bloop.'
      Write-Warn 'Some native modules may have no arm64 prebuilt binaries. If the build or the app fails,'
      Write-Warn 'install the x64 Node.js (it runs under emulation) and run this again for an x64 build.'
    } else {
      Write-Info 'Windows on ARM with x64 Node.js: building the x64 app, which runs under emulation.'
    }
  }
  Write-Ok "building for win-$($script:NodeArch)"

  try {
    $drive = Get-PSDrive -Name ((Resolve-Path $Root).Drive.Name) -ErrorAction Stop
    if ($drive.Free -lt 2.5GB) { Write-Warn ("Only {0:N1} GB free. The build needs about 2 GB." -f ($drive.Free / 1GB)) }
  } catch { }
}

# ------------------------------------------------------------------ build

function Update-Source {
  if ($NoPull -or -not (Test-Path (Join-Path $Root '.git')) -or -not (Test-Command 'git')) { return }
  Write-Step 'Getting the latest code'
  if ($null -eq (Get-NativeOutput 'git' @('-C', $Root, 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'))) {
    Write-Info 'This branch has no upstream; building the code as it is.'
    return
  }
  $dirty = Get-NativeOutput 'git' @('-C', $Root, 'status', '--porcelain', '--untracked-files=no')
  if ($dirty) { Write-Warn "You have local changes, so I'm not pulling. Building the code as it is."; return }
  $before = Get-NativeOutput 'git' @('-C', $Root, 'rev-parse', 'HEAD')
  & git -C $Root pull --ff-only
  if ($LASTEXITCODE -ne 0) { Write-Warn 'git pull failed (offline, or no access?). Building the code you already have.'; return }
  $after = Get-NativeOutput 'git' @('-C', $Root, 'rev-parse', 'HEAD')
  if ($before -ne $after) {
    Write-Ok ('updated to ' + (Get-NativeOutput 'git' @('-C', $Root, 'log', '-1', '--format=%h %s')))
    # This script may have changed too: run the new copy.
    $hostExe = (Get-Process -Id $PID).Path
    $argList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $PSCommandPath, '-NoPull')
    $argList += $ScriptSwitches
    & $hostExe @argList
    exit $LASTEXITCODE
  }
  Write-Ok ('already up to date (' + (Get-NativeOutput 'git' @('-C', $Root, 'log', '-1', '--format=%h')) + ')')
}

function Install-Dependencies {
  Write-Step 'Installing dependencies (first time takes a few minutes)'
  $lock = Join-Path $Root 'package-lock.json'
  $stamp = Join-Path $Root 'node_modules\.bloop-install-stamp'
  Push-Location $Root
  try {
    if (Test-Path $lock) {
      $want = (Get-FileHash $lock -Algorithm SHA256).Hash + '|' + (Get-NativeOutput 'node' @('-v')) + '|' + $script:NodeArch
      $have = if (Test-Path $stamp) { (Get-Content $stamp -Raw).Trim() } else { '' }
      if ($want -eq $have -and (Test-Path (Join-Path $Root 'node_modules\electron\dist'))) {
        Write-Ok 'node_modules already matches package-lock.json'
        return
      }
      Invoke-Native 'npm.cmd' @('ci', '--no-audit', '--no-fund')
      Set-Content -Path $stamp -Value $want -Encoding ASCII
    } else {
      Write-Warn 'No package-lock.json, using npm install.'
      Invoke-Native 'npm.cmd' @('install', '--no-audit', '--no-fund')
    }
    Write-Ok 'dependencies installed'
  } finally { Pop-Location }
}

function Build-App {
  Push-Location $Root
  try {
    if ($Fast) {
      Write-Step 'Skipping the type check (-Fast)'
    } else {
      Write-Step 'Type-checking'
      Invoke-Native 'npm.cmd' @('run', '--silent', 'typecheck')
      Write-Ok 'types OK'
    }

    Write-Step 'Bundling the app'
    Invoke-Native 'node' @('scripts/bundle-model.mjs', '--check')
    Invoke-Native 'npx.cmd' @('--no-install', 'electron-vite', 'build')
    Write-Ok 'bundled into out\'

    Write-Step "Packaging Bloop for win-$($script:NodeArch)"
    $env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'   # unsigned local build; don't look for certificates
    # Dummy update feed: Bloop has no auto-updater, and this keeps electron-builder from needing a
    # GitHub remote in .git. Nothing is published or downloaded.
    Invoke-Native 'npx.cmd' @('--no-install', 'electron-builder', '--win', 'dir', "--$($script:NodeArch)", '--publish', 'never',
      '-c.publish.provider=generic', '-c.publish.url=https://localhost/bloop-no-updates')
    Write-Ok 'packaged'
  } finally { Pop-Location }
}

# ------------------------------------------------------------------ install

function Stop-Bloop {
  $procs = @(Get-Process -Name 'Bloop' -ErrorAction SilentlyContinue)
  if ($procs.Count -eq 0) { return }
  Write-Info 'Quitting the running Bloop...'
  foreach ($p in $procs) { try { [void]$p.CloseMainWindow() } catch { } }
  try { $procs | Wait-Process -Timeout 5 -ErrorAction SilentlyContinue } catch { }
  Get-Process -Name 'Bloop' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 800
}

# A Bloop installed earlier with the NSIS Setup .exe lives in the same folder; remove it cleanly first.
function Remove-NsisInstall {
  $nsisUninstaller = Join-Path $InstallDir 'Uninstall Bloop.exe'
  if (-not (Test-Path $nsisUninstaller)) { return }
  Write-Info 'Found Bloop from the Setup installer; uninstalling it first (your data is kept)...'
  Start-Process -FilePath $nsisUninstaller -ArgumentList '/S' -Wait
  # The NSIS uninstaller re-launches itself from %TEMP%, so wait for the files to go.
  for ($i = 0; $i -lt 60 -and (Test-Path $nsisUninstaller); $i++) { Start-Sleep -Milliseconds 500 }
}

$ShortcutSource = @'
using System;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Text;

namespace BloopInstall {
  [ComImport, Guid("000214F9-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IShellLinkW {
    void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszFile, int cch, IntPtr pfd, uint fFlags);
    void GetIDList(out IntPtr ppidl);
    void SetIDList(IntPtr pidl);
    void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszName, int cch);
    void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string pszName);
    void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszDir, int cch);
    void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string pszDir);
    void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszArgs, int cch);
    void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string pszArgs);
    void GetHotkey(out short pwHotkey);
    void SetHotkey(short wHotkey);
    void GetShowCmd(out int piShowCmd);
    void SetShowCmd(int iShowCmd);
    void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszIconPath, int cch, out int piIcon);
    void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string pszIconPath, int iIcon);
    void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string pszPathRel, uint dwReserved);
    void Resolve(IntPtr hwnd, uint fFlags);
    void SetPath([MarshalAs(UnmanagedType.LPWStr)] string pszFile);
  }

  [StructLayout(LayoutKind.Sequential, Pack = 4)]
  struct PropertyKey {
    public Guid fmtid;
    public uint pid;
  }

  // PROPVARIANT holding a VT_LPWSTR. 24 bytes covers the 64-bit layout (16 on 32-bit).
  [StructLayout(LayoutKind.Explicit, Size = 24)]
  struct PropVariant {
    [FieldOffset(0)] public ushort vt;
    [FieldOffset(8)] public IntPtr pointer;
  }

  [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IPropertyStore {
    void GetCount(out uint cProps);
    void GetAt(uint iProp, out PropertyKey pkey);
    void GetValue(ref PropertyKey key, out PropVariant pv);
    void SetValue(ref PropertyKey key, ref PropVariant pv);
    void Commit();
  }

  [ComImport, Guid("00021401-0000-0000-C000-000000000046")]
  class CShellLink { }

  public static class Shortcut {
    [DllImport("ole32.dll")]
    static extern int PropVariantClear(ref PropVariant pvar);

    // Writes a .lnk to `target`. With `appId`, also sets System.AppUserModel.ID on it, which Windows
    // needs to show toast notifications from an app whose AppUserModelId is `appId`.
    public static void Create(string lnkPath, string target, string workDir, string description, string appId) {
      IShellLinkW link = (IShellLinkW)new CShellLink();
      try {
        link.SetPath(target);
        link.SetWorkingDirectory(workDir);
        link.SetDescription(description);
        link.SetIconLocation(target, 0);
        if (!String.IsNullOrEmpty(appId)) {
          IPropertyStore store = (IPropertyStore)link;
          PropertyKey key = new PropertyKey();
          key.fmtid = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3");
          key.pid = 5;
          PropVariant pv = new PropVariant();
          pv.vt = 31; // VT_LPWSTR
          pv.pointer = Marshal.StringToCoTaskMemUni(appId);
          try {
            store.SetValue(ref key, ref pv);
            store.Commit();
          } finally {
            PropVariantClear(ref pv);
          }
        }
        ((IPersistFile)link).Save(lnkPath, true);
      } finally {
        Marshal.ReleaseComObject(link);
      }
    }
  }
}
'@

function New-BloopShortcut([string]$LnkPath, [string]$Target, [string]$AppUserModelId) {
  $dir = Split-Path -Parent $LnkPath
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  if (Test-Path $LnkPath) { Remove-Item $LnkPath -Force }
  try {
    if (-not ('BloopInstall.Shortcut' -as [type])) { Add-Type -TypeDefinition $ShortcutSource -Language CSharp }
    [BloopInstall.Shortcut]::Create($LnkPath, $Target, (Split-Path -Parent $Target), 'Your little study pet', $AppUserModelId)
    return $true
  } catch {
    # Fallback without the AppUserModelId: notifications may not show from this shortcut.
    Write-Warn "Couldn't set the notification ID on the shortcut ($($_.Exception.Message)); using a plain shortcut."
    $shell = New-Object -ComObject WScript.Shell
    $s = $shell.CreateShortcut($LnkPath)
    $s.TargetPath = $Target
    $s.WorkingDirectory = Split-Path -Parent $Target
    $s.IconLocation = "$Target,0"
    $s.Description = 'Your little study pet'
    $s.Save()
    return $false
  }
}

function Install-Bloop {
  Write-Step 'Installing Bloop'
  $built = $null
  foreach ($name in @("win-$($script:NodeArch)-unpacked", 'win-unpacked')) {
    $candidate = Join-Path $Root "dist\$name"
    if (Test-Path (Join-Path $candidate 'Bloop.exe')) { $built = $candidate; break }
  }
  if (-not $built) { Stop-Install "Couldn't find the built Bloop.exe in dist\." }

  Stop-Bloop
  Remove-NsisInstall
  if (Test-Path $InstallDir) {
    # Replace everything except a .env you may have put next to Bloop.exe (see README, .env fallback).
    Get-ChildItem -LiteralPath $InstallDir -Force | Where-Object { $_.Name -ne '.env' } | Remove-Item -Recurse -Force
  } else {
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
  }
  Copy-Item -Path (Join-Path $built '*') -Destination $InstallDir -Recurse -Force
  Copy-Item -Path (Join-Path $Root 'scripts\uninstall.ps1') -Destination (Join-Path $InstallDir 'uninstall.ps1') -Force
  $exe = Join-Path $InstallDir 'Bloop.exe'
  Write-Ok "app:        $exe"

  $startMenu = Join-Path ([Environment]::GetFolderPath('Programs')) 'Bloop.lnk'
  if (New-BloopShortcut $startMenu $exe $AppId) {
    Write-Ok "Start menu: $startMenu (notification ID $AppId)"
  } else {
    Write-Ok "Start menu: $startMenu"
  }
  if (-not $NoDesktopShortcut) {
    $desktop = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Bloop.lnk'
    [void](New-BloopShortcut $desktop $exe $AppId)
    Write-Ok "Desktop:    $desktop"
  }

  # Settings > Apps > Installed apps entry, pointing at the uninstall script.
  $version = (Get-Content (Join-Path $Root 'package.json') -Raw | ConvertFrom-Json).version
  $sizeKb = [int]((Get-ChildItem -LiteralPath $InstallDir -Recurse -File | Measure-Object -Property Length -Sum).Sum / 1KB)
  if (-not (Test-Path $UninstallKey)) { New-Item -Path $UninstallKey -Force | Out-Null }
  $props = @{
    DisplayName     = 'Bloop'
    DisplayVersion  = $version
    Publisher       = 'Bloop team'
    DisplayIcon     = $exe
    InstallLocation = $InstallDir
    UninstallString = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$InstallDir\uninstall.ps1`""
    Comments        = 'Built from source with scripts\install.ps1'
  }
  foreach ($k in $props.Keys) { Set-ItemProperty -Path $UninstallKey -Name $k -Value $props[$k] }
  New-ItemProperty -Path $UninstallKey -Name 'EstimatedSize' -Value $sizeKb -PropertyType DWord -Force | Out-Null
  New-ItemProperty -Path $UninstallKey -Name 'NoModify' -Value 1 -PropertyType DWord -Force | Out-Null
  New-ItemProperty -Path $UninstallKey -Name 'NoRepair' -Value 1 -PropertyType DWord -Force | Out-Null
  Write-Ok 'listed in Settings > Apps > Installed apps'
}

function Remove-BuildOutput {
  if ($KeepBuild) { return }
  foreach ($name in @('win-unpacked', 'win-x64-unpacked', 'win-arm64-unpacked', 'builder-debug.yml', 'builder-effective-config.yaml')) {
    $p = Join-Path $Root "dist\$name"
    if (Test-Path $p) { Remove-Item -LiteralPath $p -Recurse -Force -ErrorAction SilentlyContinue }
  }
  $dist = Join-Path $Root 'dist'
  if ((Test-Path $dist) -and -not (Get-ChildItem -LiteralPath $dist -Force)) { Remove-Item -LiteralPath $dist -Force }
}

# ------------------------------------------------------------------ Bloop model

# The on-device Bloop model. URL, sha256, size and file name come from src\main\ai\local\bloop.ts
# (through scripts\model-info.mjs), so there is one source of truth. It goes where the app looks for a
# downloaded model: %APPDATA%\bloop\models\<file>. The app lists it as "downloaded" but keeps it OFF
# until the user turns it on. Nothing here ever fails the install.
#
# TEST ONLY: BLOOP_MODEL_URL_OVERRIDE / BLOOP_MODEL_SHA256_OVERRIDE / BLOOP_MODEL_BYTES_OVERRIDE
# (read by model-info.mjs) point this at a local server and a small fake file. Never set them normally.

function Get-FileSha256([string]$Path) {
  return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
}

function Get-FreeBytes([string]$Path) {
  try {
    $drive = New-Object System.IO.DriveInfo (Split-Path -Qualifier $Path)
    return [int64]$drive.AvailableFreeSpace
  } catch { return $null }
}

# Does the checks, then starts curl.exe in the background (resumable) so the download runs while the
# app builds. Falls back to a download in Complete-ModelDownload when curl.exe is missing.
function Start-ModelDownload {
  Write-Step 'Bloop model'
  if ($NoModel) {
    Write-Info 'Skipping the on-device Bloop model (-NoModel). You can download it later in Settings > AI.'
    return
  }
  try {
    $json = Get-NativeOutput 'node' @((Join-Path $PSScriptRoot 'model-info.mjs'))
    if (-not $json) { Write-Warn "Couldn't read the Bloop model info, so skipping the model. Bloop works without it."; return }
    $info = $json | ConvertFrom-Json
    $url = [string]$info.url; $sha = ([string]$info.sha256).ToLowerInvariant(); $bytes = [int64]$info.bytes; $file = [string]$info.file
    if (-not $url -or $sha -notmatch '^[0-9a-f]{64}$' -or $bytes -le 0 -or -not $file -or $file -match '[\\/]') {
      Write-Warn "The Bloop model isn't configured for download, so skipping it."; return
    }
    # Only https (plain http is allowed solely for the local test server, BLOOP_TEST_MODE=1).
    if ($url -notmatch '^https://' -and $env:BLOOP_TEST_MODE -ne '1') {
      Write-Warn "The Bloop model URL isn't https, so skipping it."; return
    }
    $mb = [int][math]::Floor($bytes / 1000000)  # decimal MB, matching the app (532 MB)
    Write-Info "Downloading the Bloop model ($mb MB, runs on your computer; turn it on in Settings > AI)... use -NoModel to skip"

    $dir = Join-Path $env:APPDATA 'bloop\models'
    $dest = Join-Path $dir $file
    $part = "$dest.part"
    if (Test-Path -LiteralPath "$dest.imported") { Write-Ok 'a Bloop model you imported is already in place; leaving it alone'; return }
    if (Test-Path -LiteralPath $dest) {
      if ((Get-Item -LiteralPath $dest).Length -eq $bytes -and (Get-FileSha256 $dest) -eq $sha) {
        Write-Ok "Bloop model already downloaded and verified ($dest); not downloading again"
        return
      }
      Write-Warn 'The Bloop model file on disk has the wrong size or checksum; downloading it again.'
    }

    $curl = Get-Command 'curl.exe' -ErrorAction SilentlyContinue
    # Offline (or the server is unreachable): skip.
    $reachable = $false
    if ($curl) {
      & $curl.Source -fsIL --max-time 15 -o NUL $url 2>$null
      $reachable = ($LASTEXITCODE -eq 0)
    } else {
      try { Invoke-WebRequest -Uri $url -Method Head -UseBasicParsing -TimeoutSec 15 | Out-Null; $reachable = $true } catch { }
    }
    if (-not $reachable) {
      Write-Warn "Can't reach the model download server (offline?), so skipping the Bloop model."
      Write-Warn 'Bloop still works; download it later in Settings > AI, or re-run this installer.'
      return
    }

    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $have = 0
    if (Test-Path -LiteralPath $part) { $have = (Get-Item -LiteralPath $part).Length }
    if ($have -gt $bytes) { Remove-Item -LiteralPath $part -Force; $have = 0 }
    $needBytes = ($bytes - $have) + 200MB
    $free = Get-FreeBytes $dir
    if ($null -ne $free -and $free -lt $needBytes) {
      Write-Warn ("Not enough free disk space for the Bloop model (needs about {0} MB, {1} MB free), so skipping it." -f [int]($needBytes / 1MB), [int]($free / 1MB))
      return
    }
    if ($have -gt 0) { Write-Info ("resuming the Bloop model download from {0} MB" -f [int]($have / 1000000)) }

    $script:ModelCtx = @{ Url = $url; Sha = $sha; Bytes = $bytes; Dest = $dest; Part = $part; Mb = $mb; Err = (Join-Path $env:TEMP 'bloop-model-curl.err') }
    if ($curl -and $have -lt $bytes) {
      $curlArgs = @('-fL', '--retry', '3', '--retry-delay', '2', '--connect-timeout', '20', '-C', '-', '-sS', '-o', "`"$part`"", "`"$url`"")
      $script:ModelProc = Start-Process -FilePath $curl.Source -ArgumentList $curlArgs -NoNewWindow -PassThru -RedirectStandardError $script:ModelCtx.Err
      Write-Info '(downloading in the background while Bloop builds)'
    }
  } catch {
    Write-Warn "Couldn't start the Bloop model download ($($_.Exception.Message)). Bloop works without it."
    $script:ModelProc = $null; $script:ModelCtx = $null
  }
}

# Waits for the background download (showing progress), verifies the sha256, and moves it into place.
function Complete-ModelDownload {
  $c = $script:ModelCtx
  if (-not $c) { return }
  try {
    $proc = $script:ModelProc
    if ($proc -and -not $proc.HasExited) {
      Write-Step 'Finishing the Bloop model download'
      while (-not $proc.HasExited) {
        $cur = 0
        if (Test-Path -LiteralPath $c.Part) { $cur = (Get-Item -LiteralPath $c.Part).Length }
        Write-Host ("`r    {0} / {1} MB ({2}%)   " -f [int]($cur / 1000000), [int]($c.Bytes / 1000000), [int](100 * $cur / $c.Bytes)) -NoNewline
        Start-Sleep -Seconds 1
      }
      Write-Host ''
    }
    if ($proc) {
      $proc.WaitForExit()
      if ($proc.ExitCode -ne 0) {
        $err = ''
        if (Test-Path -LiteralPath $c.Err) { $err = (Get-Content -LiteralPath $c.Err -Raw -ErrorAction SilentlyContinue) }
        Write-Warn "The Bloop model download didn't finish (curl exit code $($proc.ExitCode)$(if ($err) { ': ' + $err.Trim() })). Bloop works without it."
        Write-Warn 'Re-run this installer to resume, or download it in Settings > AI.'
        # 33 / 22: the server can't resume (or rejected the range). Don't resume that .part next time.
        if (($proc.ExitCode -eq 33 -or $proc.ExitCode -eq 22) -and (Test-Path -LiteralPath $c.Part)) { Remove-Item -LiteralPath $c.Part -Force -ErrorAction SilentlyContinue }
        return
      }
    } elseif (-not (Test-Path -LiteralPath $c.Part) -or (Get-Item -LiteralPath $c.Part).Length -lt $c.Bytes) {
      # No curl.exe: BITS (resumes by itself), else a plain download.
      Write-Info 'downloading (curl.exe not found)...'
      if (Get-Command Start-BitsTransfer -ErrorAction SilentlyContinue) {
        $pp = $ProgressPreference; $ProgressPreference = 'Continue'
        try { Start-BitsTransfer -Source $c.Url -Destination $c.Part -DisplayName 'Bloop model' } finally { $ProgressPreference = $pp }
      } else {
        Invoke-WebRequest -Uri $c.Url -OutFile $c.Part -UseBasicParsing
      }
    }
    if (-not (Test-Path -LiteralPath $c.Part)) { Write-Warn 'The Bloop model download produced no file. Bloop works without it.'; return }
    $size = (Get-Item -LiteralPath $c.Part).Length
    if ($size -ne $c.Bytes) {
      Write-Warn "The Bloop model download has the wrong size ($size of $($c.Bytes) bytes); deleting it. Download it later in Settings > AI."
      Remove-Item -LiteralPath $c.Part -Force; return
    }
    Write-Info 'verifying checksum...'
    if ((Get-FileSha256 $c.Part) -ne $c.Sha) {
      Write-Warn 'The Bloop model failed its checksum, so I deleted it. Bloop works without it; download it later in Settings > AI.'
      Remove-Item -LiteralPath $c.Part -Force; return
    }
    Move-Item -LiteralPath $c.Part -Destination $c.Dest -Force
    Write-Ok "Bloop model downloaded and verified ($($c.Mb) MB): $($c.Dest)"
    Write-Info 'It is OFF until you choose "Use Bloop model" in Settings > AI.'
  } catch {
    Write-Warn "The Bloop model download failed ($($_.Exception.Message)). Bloop works without it; download it later in Settings > AI."
  } finally {
    Remove-Item -LiteralPath $c.Err -Force -ErrorAction SilentlyContinue
    $script:ModelProc = $null; $script:ModelCtx = $null
  }
}

# ------------------------------------------------------------------ main

if (-not (Test-Path (Join-Path $Root 'package.json')) -or -not (Test-Path (Join-Path $Root 'electron.vite.config.ts'))) {
  Stop-Install 'Run this from the Bloop source folder (scripts\install.ps1 inside the cloned repo).'
}
Write-Host "Bloop installer" -ForegroundColor White -NoNewline
Write-Host "  ($Root, PowerShell $($PSVersionTable.PSVersion))" -ForegroundColor DarkGray
$started = Get-Date

if ($ModelOnly) {
  if ($NoModel) { Stop-Install "-ModelOnly and -NoModel don't go together." }
  if (-not (Test-Command 'node')) { Stop-Install 'Node.js is needed to read the model info.' }
  Start-ModelDownload
  Complete-ModelDownload
  exit 0
}

Test-Tools
Update-Source
if ($Clean) {
  Write-Step 'Cleaning old build output (-Clean)'
  foreach ($d in @('dist', 'out', 'node_modules')) {
    $p = Join-Path $Root $d
    if (Test-Path $p) { Remove-Item -LiteralPath $p -Recurse -Force }
  }
  Write-Ok 'removed dist, out, node_modules'
}
Start-ModelDownload
try {
  Install-Dependencies
  Build-App
  Install-Bloop
  Remove-BuildOutput
} finally {
  # If the install stopped early, leave the .part file; the next run resumes it.
  if ($script:ModelProc -and -not $script:ModelProc.HasExited) { Stop-Process -Id $script:ModelProc.Id -Force -ErrorAction SilentlyContinue }
}
Complete-ModelDownload

if (-not $NoLaunch) {
  Write-Step 'Starting Bloop'
  Start-Process -FilePath (Join-Path $InstallDir 'Bloop.exe') -WorkingDirectory $InstallDir
  Write-Ok 'look for the pet in the top-right corner and the icon in the system tray (under the ^ arrow)'
}

$elapsed = (Get-Date) - $started
Write-Host ''
Write-Host 'Bloop is installed.' -ForegroundColor Green
Write-Host @"

  App:        $InstallDir\Bloop.exe   (Start menu: Bloop)
  Data:       %APPDATA%\bloop
  Logs:       %APPDATA%\bloop\logs\main.log   (tray icon > Open logs folder)
  Update:     run this command again
  Uninstall:  Settings > Apps > Installed apps > Bloop, or
              powershell -ExecutionPolicy Bypass -File scripts\uninstall.ps1

  You built Bloop on this PC, so SmartScreen doesn't block it. Windows Defender may scan it
  the first time it starts, which can take a few seconds.
"@
Write-Host ("  Done in {0}m{1:00}s." -f [int][math]::Floor($elapsed.TotalMinutes), $elapsed.Seconds) -ForegroundColor DarkGray
