# Remote Codex Runner

This folder is a hand-held setup bundle for running Codex on a remote Ubuntu server from now through March 31, 2026.

The goal is not to move the current desktop thread. The goal is to recreate the same worker remotely:

- Codex CLI
- your repo
- your custom skills
- your secrets
- a persistent `tmux` session
- a watchdog that recreates the session after logout or reboot

## What You Will End Up With

After setup, the server will:

1. keep a `tmux` session named `eom-revenue` alive
2. run `ralphy --codex --prd ~/ops/eom-revenue-2026-03-31.md`
3. source secrets from `~/ops/agent.env`
4. log to `~/ops/logs/eom-revenue.log`
5. restart itself after reboots via a `systemd` user timer

## Assumptions

- The remote host is Ubuntu 24.04 LTS
- You can SSH into it as your normal Linux user
- You want the repo at `~/work/x402-data-bazaar`
- You want to use your custom skills from your Windows machine

## Step 1: Create The Server

Create an Ubuntu 24.04 VPS with at least:

- 4 vCPU
- 8 GB RAM
- 80 GB SSD

Make sure SSH key login works before doing anything else.

## Step 2: Clone This Repo On The Server

SSH into the server and run:

```bash
mkdir -p ~/work
cd ~/work
git clone <YOUR_X402_DATA_BAZAAR_REMOTE_URL> x402-data-bazaar
cd ~/work/x402-data-bazaar
```

If GitHub access is not ready yet:

```bash
ssh-keygen -t ed25519 -C "codex-remote"
cat ~/.ssh/id_ed25519.pub
```

Add that public key to GitHub, then retry the clone.

## Step 3: Install The Base Toolchain

From the repo root on the server:

```bash
cd ~/work/x402-data-bazaar
bash docs/remote-codex-runner/bootstrap-ubuntu.sh
```

That script installs:

- Node.js
- `@openai/codex`
- `vercel`
- `ralphy-cli`
- `git`, `tmux`, `jq`, `curl`, `ripgrep`

## Step 4: Log Codex Into The Server

Use an API key on the server:

```bash
export OPENAI_API_KEY="YOUR_OPENAI_API_KEY"
printenv OPENAI_API_KEY | codex login --with-api-key
codex login status
```

Do not copy your desktop auth/session files. Login fresh on the server.

## Step 5: Copy Your Custom Skills To The Server

Run this from your Windows machine:

```powershell
scp -r "$HOME\.codex\skills" user@YOUR_SERVER:~/.codex/
scp -r "$HOME\.agents\skills" user@YOUR_SERVER:~/.agents/
scp "$HOME\.codex\config.toml" user@YOUR_SERVER:~/.codex/config.toml
```

This is what gives the remote server the same installed skill inventory you have locally.

## Step 6: Create The Secrets File

On the server:

```bash
mkdir -p ~/ops
cp ~/work/x402-data-bazaar/docs/remote-codex-runner/agent.env.template ~/ops/agent.env
nano ~/ops/agent.env
chmod 600 ~/ops/agent.env
```

Fill in the real values.

Minimum keys for meaningful autonomous work:

- `OPENAI_API_KEY`
- `VERCEL_TOKEN`
- `CDP_API_KEY_ID`
- `CDP_API_KEY_SECRET`
- `KV_REST_API_URL`
- `KV_REST_API_TOKEN`
- `METRICS_DASHBOARD_PASSWORD`

## Step 7: Install The Mission File

On the server:

```bash
cp ~/work/x402-data-bazaar/docs/remote-codex-runner/eom-revenue-2026-03-31.md ~/ops/eom-revenue-2026-03-31.md
```

Edit it if you want to tighten budget, channels, or guardrails.

## Step 7.5: Install The Business OS Seed

On the local machine, refresh the seed snapshot:

```powershell
powershell -ExecutionPolicy Bypass -File docs/remote-codex-runner/export-business-os-seed.ps1
```

On the server, install the seed into `~/ops/business-os`:

```bash
bash ~/work/x402-data-bazaar/docs/remote-codex-runner/install-business-os.sh
```

This gives the remote loop the same operator artifacts and memos as the local business OS.

## Refreshing An Existing Runner

When the local business OS or seller repo changes, build a fresh runner bundle on the local machine:

```powershell
powershell -ExecutionPolicy Bypass -File docs/remote-codex-runner/package-runner-refresh.ps1
```

Upload `docs/remote-codex-runner/runner-refresh.zip` to the remote Windows machine and extract it to:

```text
C:\Users\Administrator\runner-refresh
```

Then on the remote Ubuntu box apply the refresh, reseed `~/ops/business-os`, refresh the mission file, and restart the loop:

```bash
bash ~/work/x402-data-bazaar/docs/remote-codex-runner/apply-runner-refresh.sh /mnt/c/Users/Administrator/runner-refresh
```

This closes the gap between the local control-plane workspace and the remote unattended executor by turning local edits into a repeatable refresh package.

## Installing Daily Lane Schedules On The Remote Box

The continuous `eom-revenue` loop is still the main Chief-of-Staff runner. The lane schedules below make the specialist lanes act every weekday instead of waiting for this thread.

Lane prompt files:

- `docs/remote-codex-runner/lane-prompts/tesla.md`
- `docs/remote-codex-runner/lane-prompts/apollo.md`
- `docs/remote-codex-runner/lane-prompts/carver.md`
- `docs/remote-codex-runner/lane-prompts/franklin.md`
- `docs/remote-codex-runner/lane-prompts/proof-check.md`

Install the lane runner and cron entries on the remote Ubuntu box:

```bash
chmod +x ~/work/x402-data-bazaar/docs/remote-codex-runner/run-business-lane.sh
chmod +x ~/work/x402-data-bazaar/docs/remote-codex-runner/install-lane-crons.sh
bash ~/work/x402-data-bazaar/docs/remote-codex-runner/install-lane-crons.sh
crontab -l
```

Default weekday schedule:

- Tesla: `10:15`
- Apollo: `11:00`
- Carver: `13:15`
- Franklin: `13:45`
- Proof check: `16:45`

All lane logs go to:

```text
~/ops/logs/lanes/
```

This gives the remote box its own weekday lane cadence instead of depending on this laptop or this thread to wake the org up.

## Publishing The Business Proof Dashboard

The Proof lane can publish a clean business snapshot into the repo so the Vercel app can serve it at:

- `/ops/business`
- `/ops/business/data`
- `/ops/business/proof`

The publish flow uses a dedicated clean clone on the remote box so snapshot commits do not get mixed with product work in the main runner repo.

Files involved:

- `scripts/build_business_dashboard_snapshot.js`
- `docs/remote-codex-runner/publish-business-dashboard.sh`
- `ops-dashboard/business-dashboard.json`
- `ops-dashboard/proof-checkpoint-latest.md`

The `run-business-lane.sh` wrapper will call the publisher automatically after a successful `proof-check` lane run when `BUSINESS_DASHBOARD_PUBLISH` is not set to `0`.

The publisher commit includes:

- the latest `ops-dashboard` snapshot files
- the business dashboard server files needed by the root Vercel app

So once the remote box has the refreshed runner bundle and git push rights, the daily Proof lane can update the Vercel-linked repo directly.

`/ops/business/proof` is the external-facing truth surface for this business OS. Treat it as an evidence receipt, not a hype page: keep `observed`, `inferred`, and `missing` proof separate, and do not let remote or local claims outrun the receipt.

## Step 8: Install The Launcher Script

On the server:

```bash
mkdir -p ~/bin ~/ops/logs
cp ~/work/x402-data-bazaar/docs/remote-codex-runner/start-eom-loop.sh ~/bin/start-eom-loop.sh
chmod +x ~/bin/start-eom-loop.sh
```

## Step 9: Install The Watchdog

On the server:

```bash
mkdir -p ~/.config/systemd/user
cp ~/work/x402-data-bazaar/docs/remote-codex-runner/codex-watchdog.service ~/.config/systemd/user/
cp ~/work/x402-data-bazaar/docs/remote-codex-runner/codex-watchdog.timer ~/.config/systemd/user/
sudo loginctl enable-linger "$USER"
systemctl --user daemon-reload
systemctl --user enable --now codex-watchdog.timer
```

This makes the watchdog run on boot and every 5 minutes. If the `tmux` session disappears, the script recreates it.

## Step 10: Start The Loop Right Away

You can wait for the timer, or start it immediately:

```bash
bash ~/bin/start-eom-loop.sh
```

## Step 11: Verify Everything

Check that the session exists:

```bash
tmux -S ~/.tmux/sock list-sessions
```

Read the latest output:

```bash
tmux -S ~/.tmux/sock capture-pane -t eom-revenue -p | tail -50
```

Check the watchdog:

```bash
systemctl --user status codex-watchdog.timer
journalctl --user -u codex-watchdog.service -n 50 --no-pager
```

Check the run log:

```bash
tail -50 ~/ops/logs/eom-revenue.log
```

## Step 12: Link Deploy Targets Once

If you want unattended Vercel deploys, link each app once on the server:

```bash
cd ~/work/x402-data-bazaar/apps/restricted-party-screen
vercel link --project restricted-party-screen --yes

cd ~/work/x402-data-bazaar/apps/vendor-entity-brief
vercel link --project vendor-entity-brief --yes
```

## Important Caveats

- A remote Linux server is great for building, monitoring, deploying, and creating assets.
- Paid x402 self-verification still requires a funded wallet on the server if you want the server to do it unattended.
- If the wallet flow is annoying headlessly, let the server do everything except the final paid confirmation.

## If You Get Stuck

Run these three commands and look at the output first:

```bash
codex login status
tmux -S ~/.tmux/sock capture-pane -t eom-revenue -p | tail -80
journalctl --user -u codex-watchdog.service -n 80 --no-pager
```

If you want, the next thing I can do is walk you through this one step at a time in order, starting with server creation and SSH.
