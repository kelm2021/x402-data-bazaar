#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="${1:-$HOME/work/x402-data-bazaar}"
RUNNER="$REPO_DIR/docs/remote-codex-runner/run-business-lane.sh"
CRON_TMP="$(mktemp)"

if [[ ! -x "$RUNNER" ]]; then
  chmod +x "$RUNNER"
fi

{
  crontab -l 2>/dev/null | grep -v 'run-business-lane.sh' || true
  echo "15 10 * * 1-5 bash \"$RUNNER\" tesla"
  echo "00 11 * * 1-5 bash \"$RUNNER\" apollo"
  echo "15 13 * * 1-5 bash \"$RUNNER\" carver"
  echo "45 13 * * 1-5 bash \"$RUNNER\" franklin"
  echo "45 16 * * 1-5 bash \"$RUNNER\" proof-check"
} > "$CRON_TMP"

crontab "$CRON_TMP"
rm -f "$CRON_TMP"

echo "Installed weekday business lane cron jobs:"
echo "  Tesla:      10:15"
echo "  Apollo:     11:00"
echo "  Carver:     13:15"
echo "  Franklin:   13:45"
echo "  Proof check:16:45"
