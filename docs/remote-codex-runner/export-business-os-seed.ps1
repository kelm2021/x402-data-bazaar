$ErrorActionPreference = "Stop"

$workspaceRoot = "C:\Users\KentEgan\claude projects\eom-revenue-business-os"
$seedRoot = "C:\Users\KentEgan\claude projects\x402-data-bazaar\docs\remote-codex-runner\business-os-seed"

$files = @(
  "ops\\progress.md",
  "ops\\revenue-plan.md",
  "ops\\operator-scoreboard.md",
  "ops\\opportunity-scorecards.md",
  "ops\\moltbook-signal-log.md",
  "ops\\carver-now-memo.md",
  "ops\\franklin-later-bridge-memo.md",
  "ops\\tesla-autonomy-memo.md",
  "ops\\active-cycle.md",
  "ops\\dispatch-ledger.md",
  "ops\\proof-checkpoint-latest.md",
  "ops\\lane-operating-rails.md",
  "ops\\moltbook-community-map.md",
  "ops\\moltbook-follow-targets.md",
  "ops\\newton-operating-rails.md",
  "ops\\goodall-operating-rails.md",
  "ops\\hegel-operating-rails.md",
  "content\\drafts\\lead-wedge-offer-pack.md",
  "content\\drafts\\outreach-sequence.md",
  "content\\drafts\\moltbook-posts.md",
  "content\\approved\\lead-wedge-offer-pack-review.md",
  "content\\approved\\lead-wedge-one-pager.md",
  "content\\approved\\reply-pack.md",
  "content\\drafts\\outside-bazaar-offers.md",
  "revenue\\outreach\\apollo-current-cycle.md",
  "revenue\\outreach\\priority-target-list.md",
  "revenue\\outreach\\day-1-outreach-batch.md",
  "revenue\\outreach\\outside-bazaar-outreach.md",
  "revenue\\pipeline.md",
  "revenue\\metrics\\atlas-current-scorecard.md",
  "revenue\\metrics\\first-14-day-proof-plan.md",
  "revenue\\metrics\\outside-bazaar-scorecard.md",
  "builds\\reports\\forge-current-cycle.md"
)

New-Item -ItemType Directory -Force -Path $seedRoot | Out-Null

foreach ($relativePath in $files) {
  $sourcePath = Join-Path $workspaceRoot $relativePath
  if (-not (Test-Path $sourcePath)) {
    continue
  }

  $destinationPath = Join-Path $seedRoot $relativePath
  $destinationDir = Split-Path -Parent $destinationPath
  New-Item -ItemType Directory -Force -Path $destinationDir | Out-Null
  Copy-Item -Force $sourcePath $destinationPath
}

Write-Output "Exported business OS seed to $seedRoot"
