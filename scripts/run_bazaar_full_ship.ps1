[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = "C:\Users\KentEgan\claude projects\x402-data-bazaar"
$automationRoot = "C:\Users\KentEgan\.codex\automations\bazaar-full-ship"
$codexCli = "C:\Users\KentEgan\AppData\Roaming\npm\codex.cmd"
$promptPath = Join-Path $automationRoot "codex-runner.prompt.md"
$logsDir = Join-Path $automationRoot "runner-logs"
$lockPath = Join-Path $automationRoot "runner.lock.json"
$lastMessagePath = Join-Path $automationRoot "last-message.md"
$lastExitPath = Join-Path $automationRoot "last-exit.json"

if (!(Test-Path $automationRoot)) {
  New-Item -ItemType Directory -Force -Path $automationRoot | Out-Null
}

if (!(Test-Path $logsDir)) {
  New-Item -ItemType Directory -Force -Path $logsDir | Out-Null
}

if (!(Test-Path $promptPath)) {
  throw "Prompt file not found: $promptPath"
}

if (!(Test-Path $codexCli)) {
  throw "Codex CLI not found: $codexCli"
}

if (Test-Path $lockPath) {
  try {
    $lock = Get-Content -Raw $lockPath | ConvertFrom-Json
    if ($lock.pid) {
      $existing = Get-Process -Id ([int]$lock.pid) -ErrorAction SilentlyContinue
      if ($existing) {
        Write-Output "Another Bazaar full ship runner is already active (PID $($lock.pid)). Exiting."
        exit 0
      }
    }
  } catch {
    # Ignore malformed lock files and replace them.
  }
}

$lockPayload = @{
  pid = $PID
  startedAt = (Get-Date).ToString("o")
  repoRoot = $repoRoot
}
$lockPayload | ConvertTo-Json | Set-Content -Path $lockPath -Encoding utf8

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$eventLogPath = Join-Path $logsDir "$timestamp.events.jsonl"
$stdoutLogPath = Join-Path $logsDir "$timestamp.stdout.log"

try {
  $prompt = Get-Content -Raw $promptPath

  # Use the locally installed Codex CLI directly with full access so the run is not trapped
  # inside the app automation sandbox.
  $prompt |
    & $codexCli exec `
      --dangerously-bypass-approvals-and-sandbox `
      -C $repoRoot `
      --json `
      --output-last-message $lastMessagePath `
      - 2>&1 |
    Tee-Object -FilePath $eventLogPath |
    Tee-Object -FilePath $stdoutLogPath -Append |
    Out-Host

  $exitCode = $LASTEXITCODE
  $result = @{
    finishedAt = (Get-Date).ToString("o")
    exitCode = $exitCode
    eventLog = $eventLogPath
    lastMessage = $lastMessagePath
  }
  $result | ConvertTo-Json | Set-Content -Path $lastExitPath -Encoding utf8
  exit $exitCode
} finally {
  if (Test-Path $lockPath) {
    Remove-Item $lockPath -Force
  }
}
