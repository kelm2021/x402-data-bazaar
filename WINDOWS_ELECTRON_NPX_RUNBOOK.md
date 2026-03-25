# Windows/Electron `npx` Runbook (Remote Desktop)

Use this runbook when an LLM is operating on a Windows remote desktop and hitting Electron-hosted terminal quirks with `npx`.

## 1) Normalize the session first

```powershell
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$env:CI = '1'
$env:npm_config_yes = 'true'
$env:npm_config_fund = 'false'
$env:npm_config_audit = 'false'
$env:npm_config_update_notifier = 'false'
$env:npm_config_loglevel = 'warn'
$env:npm_config_cache = "$env:LOCALAPPDATA\npm-cache"
```

## 2) Resolve executables explicitly

Do not trust PATH aliases in Electron shells.

```powershell
$node = (Get-Command node.exe -ErrorAction Stop).Source
$npm  = (Get-Command npm.cmd  -ErrorAction Stop).Source
$npx  = (Get-Command npx.cmd  -ErrorAction Stop).Source
& $node -v
& $npm -v
& $npx --version
```

## 3) Prefer local project tooling

Use local dev dependencies and `npm run` over ad-hoc `npx`.

```powershell
& $npm install -D <tool>
& $npm run <script>
```

Use `npx` only for one-off tasks.

## 4) First `npx` attempt: call `npx.cmd` directly

```powershell
& $npx --yes <package-or-bin> <args>
```

## 5) If PowerShell quoting fails, route through `cmd`

```powershell
cmd /d /s /c "npx.cmd --yes <package-or-bin> <args>"
```

## 6) If `npx` still fails, use fallback executor

```powershell
pnpm dlx <package> <args>
```

If `pnpm` is missing, install it once and use `pnpm dlx` for one-offs.

## 7) Add a stable wrapper in your PowerShell profile

```powershell
function nx {
  param([Parameter(ValueFromRemainingArguments=$true)][string[]]$Args)
  $env:CI='1'; $env:npm_config_yes='true'
  $npx = (Get-Command npx.cmd -ErrorAction Stop).Source
  try {
    & $npx --yes @Args
    if ($LASTEXITCODE -eq 0) { return }
  } catch {}
  $argLine = ($Args | ForEach-Object { '"' + ($_ -replace '"','\"') + '"' }) -join ' '
  cmd /d /s /c "`"$npx`" --yes $argLine"
  if ($LASTEXITCODE -ne 0) { throw "nx failed with exit code $LASTEXITCODE" }
}
```

## 8) Use this command decision order every time

1. `npm run <script>` (preferred)
2. `npx.cmd --yes ...`
3. `cmd /c "npx.cmd --yes ..."`
4. `pnpm dlx ...`

This sequence avoids the most common Windows + Electron + PowerShell prompt and invocation failures.
