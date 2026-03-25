param(
  [Parameter(Mandatory = $true)]
  [string]$Label,
  [switch]$Reset,
  [string]$OutDir = "$env:LOCALAPPDATA\awal-debug"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Write-Info {
  param([string]$Message)
  Write-Host "[awal-debug] $Message"
}

function Get-ToolInfo {
  param(
    [string]$CommandName,
    [string[]]$VersionArgs
  )

  $result = [ordered]@{
    command = $CommandName
    found = $false
    path = $null
    version = $null
    error = $null
  }

  try {
    $cmd = Get-Command $CommandName -ErrorAction Stop
    $result.found = $true
    $result.path = $cmd.Source
    try {
      $versionOutput = (& $cmd.Source @VersionArgs 2>&1 | Out-String).Trim()
      if ($versionOutput) { $result.version = $versionOutput }
    } catch {
      $result.error = $_.Exception.Message
    }
  } catch {
    $result.error = $_.Exception.Message
  }

  return [pscustomobject]$result
}

function Get-DirSnapshot {
  param([string]$PathValue)

  $entry = [ordered]@{
    path = $PathValue
    exists = $false
    fileCount = 0
    dirCount = 0
    totalBytes = 0
    newestWriteUtc = $null
    recentFiles = @()
    error = $null
  }

  if (-not (Test-Path -LiteralPath $PathValue)) {
    return [pscustomobject]$entry
  }

  $entry.exists = $true

  try {
    $files = @(Get-ChildItem -LiteralPath $PathValue -Recurse -File -ErrorAction SilentlyContinue)
    $dirs = @(Get-ChildItem -LiteralPath $PathValue -Recurse -Directory -ErrorAction SilentlyContinue)

    $entry.fileCount = $files.Count
    $entry.dirCount = $dirs.Count
    if ($files.Count -gt 0) {
      $entry.totalBytes = [int64](($files | Measure-Object -Property Length -Sum).Sum)
      $entry.newestWriteUtc = ($files | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1 -ExpandProperty LastWriteTimeUtc).ToString("o")
      $entry.recentFiles = @(
        $files |
          Sort-Object LastWriteTimeUtc -Descending |
          Select-Object -First 25 -Property @{
            Name = "path"
            Expression = { $_.FullName }
          }, @{
            Name = "bytes"
            Expression = { $_.Length }
          }, @{
            Name = "lastWriteUtc"
            Expression = { $_.LastWriteTimeUtc.ToString("o") }
          }
      )
    }
  } catch {
    $entry.error = $_.Exception.Message
  }

  return [pscustomobject]$entry
}

function Get-AwalProcesses {
  try {
    $rows = Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object {
      $_.CommandLine -and (
        $_.CommandLine -match "awal" -or
        $_.CommandLine -match "payments-mcp-ui"
      )
    }

    return @(
      $rows | Select-Object @{
        Name = "pid"
        Expression = { [int]$_.ProcessId }
      }, @{
        Name = "ppid"
        Expression = { [int]$_.ParentProcessId }
      }, @{
        Name = "name"
        Expression = { $_.Name }
      }, @{
        Name = "commandLine"
        Expression = { $_.CommandLine }
      }
    )
  } catch {
    return @([pscustomobject]@{
      pid = -1
      ppid = -1
      name = "error"
      commandLine = $_.Exception.Message
    })
  }
}

function Stop-AwalProcesses {
  $rows = Get-AwalProcesses | Where-Object { $_.pid -gt 0 }
  foreach ($row in $rows) {
    try {
      Stop-Process -Id $row.pid -Force -ErrorAction Stop
      Write-Info "Stopped PID $($row.pid) ($($row.name))"
    } catch {
      Write-Info "Could not stop PID $($row.pid): $($_.Exception.Message)"
    }
  }
}

function Remove-PathIfExists {
  param([string]$TargetPath)
  if (Test-Path -LiteralPath $TargetPath) {
    Remove-Item -LiteralPath $TargetPath -Recurse -Force -ErrorAction SilentlyContinue
    Write-Info "Removed $TargetPath"
  }
}

function Find-AwalNamedDirs {
  param([string]$RootPath)
  if (-not (Test-Path -LiteralPath $RootPath)) { return @() }
  try {
    return @(
      Get-ChildItem -LiteralPath $RootPath -Directory -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -match "awal|payments-mcp" } |
      Select-Object -ExpandProperty FullName
    )
  } catch {
    return @()
  }
}

$localAppData = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { [IO.Path]::GetTempPath() }
$appData = if ($env:APPDATA) { $env:APPDATA } else { "" }
$userProfile = if ($env:USERPROFILE) { $env:USERPROFILE } else { "" }

$paths = [ordered]@{
  defaultAwaRoot = (Join-Path $localAppData "awal")
  defaultLock = (Join-Path (Join-Path $localAppData "awal") "payments-mcp-ui.lock")
  defaultBridge = (Join-Path (Join-Path $localAppData "awal") "payments-mcp-ui-bridge")
  legacyTmpRoot = "C:\tmp"
  legacyLock = "C:\tmp\payments-mcp-ui.lock"
  legacyBridge = "C:\tmp\payments-mcp-ui-bridge"
  appDataAwa = $(if ($appData) { Join-Path $appData "awal" } else { "" })
  userProfileDotAwa = $(if ($userProfile) { Join-Path $userProfile ".awal" } else { "" })
}

if ($Reset) {
  Write-Info "Reset requested: stopping awal-related processes and clearing stale lock/bridge files."
  Stop-AwalProcesses
  Start-Sleep -Milliseconds 400
  Remove-PathIfExists -TargetPath $paths.defaultLock
  Remove-PathIfExists -TargetPath $paths.defaultBridge
  Remove-PathIfExists -TargetPath $paths.legacyLock
  Remove-PathIfExists -TargetPath $paths.legacyBridge
}

New-Item -ItemType Directory -Path $OutDir -Force | Out-Null

$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$currentProcess = [System.Diagnostics.Process]::GetCurrentProcess()
$sessionId = [int]$currentProcess.SessionId

$parentPid = $null
try {
  $procRow = Get-CimInstance Win32_Process -Filter "ProcessId=$($currentProcess.Id)" -ErrorAction Stop
  $parentPid = [int]$procRow.ParentProcessId
} catch {
  $parentPid = -1
}

$whoamiOut = ""
try { $whoamiOut = (whoami.exe 2>&1 | Out-String).Trim() } catch { $whoamiOut = $_.Exception.Message }

$npxInfo = Get-ToolInfo -CommandName "npx.cmd" -VersionArgs @("--version")
$npmInfo = Get-ToolInfo -CommandName "npm.cmd" -VersionArgs @("--version")
$nodeInfo = Get-ToolInfo -CommandName "node.exe" -VersionArgs @("-v")

$npmRootGlobal = ""
if ($npmInfo.found -and $npmInfo.path) {
  try {
    $npmRootGlobal = (& $npmInfo.path root -g 2>&1 | Out-String).Trim()
  } catch {
    $npmRootGlobal = "ERROR: $($_.Exception.Message)"
  }
}

$namedDirs = @()
$namedDirs += Find-AwalNamedDirs -RootPath $localAppData
if ($appData) { $namedDirs += Find-AwalNamedDirs -RootPath $appData }
$namedDirs = @($namedDirs | Sort-Object -Unique)

$snapshotPaths = @(
  $paths.defaultAwaRoot,
  $paths.defaultBridge,
  $paths.legacyTmpRoot,
  $paths.legacyBridge,
  $paths.appDataAwa,
  $paths.userProfileDotAwa
) | Where-Object { $_ -and $_.Trim().Length -gt 0 } | Select-Object -Unique

$snapshots = @()
foreach ($pathItem in $snapshotPaths) {
  $snapshots += Get-DirSnapshot -PathValue $pathItem
}

$report = [ordered]@{
  label = $Label
  capturedAtUtc = (Get-Date).ToUniversalTime().ToString("o")
  host = $env:COMPUTERNAME
  user = [ordered]@{
    whoami = $whoamiOut
    username = $env:USERNAME
    userSid = $identity.User.Value
  }
  executionContext = [ordered]@{
    pid = [int]$currentProcess.Id
    parentPid = $parentPid
    processName = $currentProcess.ProcessName
    sessionId = $sessionId
    currentDirectory = (Get-Location).Path
    powershellVersion = $PSVersionTable.PSVersion.ToString()
  }
  environment = [ordered]@{
    USERPROFILE = $env:USERPROFILE
    APPDATA = $env:APPDATA
    LOCALAPPDATA = $env:LOCALAPPDATA
    TEMP = $env:TEMP
    TMP = $env:TMP
  }
  tools = [ordered]@{
    node = $nodeInfo
    npm = $npmInfo
    npx = $npxInfo
    npmRootGlobal = $npmRootGlobal
  }
  expectedPaths = $paths
  discoveredAwaDirs = $namedDirs
  runningAwaProcesses = Get-AwalProcesses
  pathSnapshots = $snapshots
}

$safeLabel = ($Label -replace "[^a-zA-Z0-9\-_]", "_")
$stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMdd-HHmmss")
$outFile = Join-Path $OutDir ("awal-context-{0}-s{1}-{2}.json" -f $safeLabel, $sessionId, $stamp)

$report | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $outFile -Encoding UTF8

Write-Info "Snapshot written: $outFile"
Write-Info "User: $($report.user.whoami) | SID: $($report.user.userSid) | Session: $sessionId"
Write-Info "npx: $($report.tools.npx.path)"
Write-Info "npm root -g: $($report.tools.npmRootGlobal)"
