# Business OS Seed

This folder is a portable seed snapshot of the local `eom-revenue-business-os` workspace.

It exists so the remote runner can start from the same business-operating context as the local Chief of Staff loop.

## Intended Remote Location

Copy this folder to:

- `~/ops/business-os`

The remote mission file in this folder is written to maintain that artifact set when it exists.

## Contents

- operator logs and scorecards
- Carver / Franklin / Tesla memos
- active cycle state
- current GTM drafts
- current outreach and metrics artifacts
- Forge report

## Refresh Flow

On the local machine, run:

```powershell
powershell -ExecutionPolicy Bypass -File docs/remote-codex-runner/export-business-os-seed.ps1
```

Then sync the repo to the remote box and install the seed there:

```bash
bash ~/work/x402-data-bazaar/docs/remote-codex-runner/install-business-os.sh
```
