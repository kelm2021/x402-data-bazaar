$ErrorActionPreference = "Stop"

$repoRoot = "C:\Users\KentEgan\claude projects\x402-data-bazaar"
$exportScript = Join-Path $repoRoot "docs\remote-codex-runner\export-business-os-seed.ps1"
$stageRoot = Join-Path $env:TEMP "x402-data-bazaar-runner-refresh-stage"
$legacyStageRoot = Join-Path $repoRoot "docs\remote-codex-runner\runner-refresh-stage"
$zipPath = Join-Path $repoRoot "docs\remote-codex-runner\runner-refresh.zip"

if ($env:SKIP_BUSINESS_OS_EXPORT -eq "1") {
  Write-Output "Skipping business OS seed export because SKIP_BUSINESS_OS_EXPORT=1"
} else {
  & $exportScript
}

Remove-Item $stageRoot -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item $legacyStageRoot -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item $zipPath -Force -ErrorAction SilentlyContinue

New-Item -ItemType Directory -Force -Path `
  "$stageRoot\docs\remote-codex-runner", `
  "$stageRoot\docs\remote-codex-runner\lane-prompts", `
  "$stageRoot\scripts", `
  "$stageRoot\test", `
  "$stageRoot\apps\restricted-party-screen", `
  "$stageRoot\apps\vendor-entity-brief" | Out-Null

$docFiles = @(
  "README.md",
  "agent.env.template",
  "bootstrap-ubuntu.sh",
  "codex-watchdog.service",
  "codex-watchdog.timer",
  "eom-revenue-2026-03-31.md",
  "export-business-os-seed.ps1",
  "install-business-os.sh",
  "start-eom-loop.sh",
  "apply-runner-refresh.sh",
  "publish-business-dashboard.sh",
  "run-business-lane.sh",
  "install-lane-crons.sh",
  "package-runner-refresh.ps1"
)

foreach ($docFile in $docFiles) {
  Copy-Item (Join-Path $repoRoot "docs\remote-codex-runner\$docFile") "$stageRoot\docs\remote-codex-runner\" -Force
}

Copy-Item -Recurse "$repoRoot\docs\remote-codex-runner\business-os-seed" "$stageRoot\docs\remote-codex-runner\" -Force
Copy-Item -Recurse "$repoRoot\docs\remote-codex-runner\lane-prompts" "$stageRoot\docs\remote-codex-runner\" -Force
Copy-Item "$repoRoot\scripts\build_business_dashboard_snapshot.js" "$stageRoot\scripts\" -Force
Copy-Item "$repoRoot\app.js" "$stageRoot\" -Force
Copy-Item "$repoRoot\business-dashboard.js" "$stageRoot\" -Force
Copy-Item "$repoRoot\index.js" "$stageRoot\" -Force
Copy-Item "$repoRoot\package.json" "$stageRoot\" -Force
Copy-Item "$repoRoot\test\business-dashboard.test.js" "$stageRoot\test\" -Force
Copy-Item -Recurse "$repoRoot\apps\restricted-party-screen\*" "$stageRoot\apps\restricted-party-screen\" -Force
Copy-Item -Recurse "$repoRoot\apps\vendor-entity-brief\*" "$stageRoot\apps\vendor-entity-brief\" -Force
Copy-Item "$repoRoot\metrics.js" "$stageRoot\" -Force

Get-ChildItem $stageRoot -Recurse -Directory | Where-Object {
  $_.Name -in @("node_modules", ".vercel", "output")
} | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue

Compress-Archive -Path "$stageRoot\*" -DestinationPath $zipPath -Force

$hash = (Get-FileHash $zipPath -Algorithm SHA256).Hash
Write-Output "Created refresh package: $zipPath"
Write-Output "SHA256: $hash"
