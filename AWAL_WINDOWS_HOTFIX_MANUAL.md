# awal Windows Hotfix Manual (Remote Desktop)

This manual documents exactly what was changed on this machine to get `awal` running on Windows Server with RDP.

## Scope

- OS: Windows Server 2019
- Shell: PowerShell
- Runtime: Node v24.14.0
- Package: `awal` v2.2.0 (global install)
- Symptom: `spawn EINVAL`, then IPC timeouts

## 1) Find global `awal` install path

```powershell
$globalNodeModules = npm root -g
$awalRoot = Join-Path $globalNodeModules "awal"
$awalRoot
```

## 2) Back up files before editing

```powershell
$files = @(
  "dist/serverManager.js",
  "dist/processCheck.js",
  "dist/ipcClient.js",
  "dist/server-bundle/bundle-electron.js"
)

foreach ($f in $files) {
  Copy-Item (Join-Path $awalRoot $f) (Join-Path $awalRoot "$f.bak") -Force
}
```

## 3) Apply fixes that were made

### 3.1 `serverManager.js`

- Change Electron spawn config to include `shell: true`.
- Reason: fixes Windows `spawn EINVAL` in this environment.

### 3.2 `processCheck.js`

- Replace lock path from `/tmp/...` to `C:/tmp/...`.
- Reason: Linux temp path was invalid on this host.

### 3.3 `ipcClient.js`

- Replace IPC bridge path from `/tmp/...` to `C:/tmp/...`.
- Reason: keep client and Electron bridge paths aligned on Windows.

### 3.4 `server-bundle/bundle-electron.js`

- Replace all `/tmp/payments-mcp-ui` references with `C:/tmp/payments-mcp-ui`.
- Reason: make Electron lock/bridge files resolve on Windows.

## 4) Create required temp folders

```powershell
New-Item -ItemType Directory -Force -Path "C:\tmp" | Out-Null
New-Item -ItemType Directory -Force -Path "C:\tmp\payments-mcp-ui-bridge\requests" | Out-Null
New-Item -ItemType Directory -Force -Path "C:\tmp\payments-mcp-ui-bridge\responses" | Out-Null
```

## 5) Verification checklist used

After starting `awal`, verify:

1. Electron process starts (no `spawn EINVAL`).
2. Lock file exists: `C:\tmp\payments-mcp-ui.lock`.
3. Bridge folders exist:
   - `C:\tmp\payments-mcp-ui-bridge\requests`
   - `C:\tmp\payments-mcp-ui-bridge\responses`
4. CLI writes a request JSON into `requests`.
5. Expected: Electron writes matching response JSON into `responses`.

## 6) Current known state

- Electron starts successfully.
- Lock file and bridge dirs are created.
- CLI writes request files.
- Current blocker: request times out after ~30s because no response file is written by Electron.

Working hypothesis:

- `fs.watch()` in Electron is not reliably firing on this Windows/RDP setup.

## 7) Next fix in progress

- Add polling fallback in Electron IPC handler (`fs.watch` + interval scan).
- Keep watch mode, but process queued request files via periodic directory scan.

## 8) Rollback

Restore backups:

```powershell
foreach ($f in $files) {
  Copy-Item (Join-Path $awalRoot "$f.bak") (Join-Path $awalRoot $f) -Force
}
```

Or reinstall global package cleanly:

```powershell
npm uninstall -g awal
npm install -g awal@2.2.0
```

## 9) Productization note

These are local hotfixes. For a reusable package, avoid patching global installed files in place; ship a wrapper/adapter with:

- per-user temp path (`LOCALAPPDATA`/`os.tmpdir()`)
- safer IPC (or polling fallback by default)
- structured logs/metrics
- explicit upgrade/rollback process
