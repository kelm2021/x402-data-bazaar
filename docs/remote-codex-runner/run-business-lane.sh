#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${ENV_FILE:-$HOME/ops/agent.env}"
LANE_NAME="${1:-}"
PROMPT_FILE="${2:-}"

if [[ -z "$LANE_NAME" ]]; then
  echo "Usage: run-business-lane.sh <lane-name> [prompt-file]" >&2
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing env file: $ENV_FILE" >&2
  exit 1
fi

set -a
source "$ENV_FILE"
set +a

export PATH="/usr/local/bin:/usr/bin:$HOME/.npm-global/bin:$PATH"

OPS_DIR="${OPS_DIR:-$HOME/ops}"
REPO_DIR="${REPO_DIR:-$HOME/work/x402-data-bazaar}"
LANE_DIR="$REPO_DIR/docs/remote-codex-runner/lane-prompts"
PROMPT_FILE="${PROMPT_FILE:-$LANE_DIR/$LANE_NAME.md}"
LOG_DIR="$OPS_DIR/logs/lanes"
LOG_FILE="$LOG_DIR/$LANE_NAME.log"

mkdir -p "$LOG_DIR"

if [[ ! -d "$REPO_DIR" ]]; then
  echo "Missing repo directory: $REPO_DIR" >&2
  exit 1
fi

if [[ ! -f "$PROMPT_FILE" ]]; then
  echo "Missing lane prompt: $PROMPT_FILE" >&2
  exit 1
fi

cd "$REPO_DIR"

echo "$(date -Is) STARTING:$LANE_NAME" | tee -a "$LOG_FILE"
codex exec --dangerously-bypass-approvals-and-sandbox - < "$PROMPT_FILE" 2>&1 | tee -a "$LOG_FILE"
EXIT_CODE=${PIPESTATUS[0]}

if [[ "$EXIT_CODE" -eq 0 && "$LANE_NAME" == "proof-check" && "${BUSINESS_DASHBOARD_PUBLISH:-1}" == "1" ]]; then
  PUBLISH_SCRIPT="$REPO_DIR/docs/remote-codex-runner/publish-business-dashboard.sh"
  echo "$(date -Is) STARTING:$LANE_NAME:publish-business-dashboard" | tee -a "$LOG_FILE"
  bash "$PUBLISH_SCRIPT" "$OPS_DIR/business-os" "$REPO_DIR" "$HOME/work/x402-data-bazaar-dashboard-publisher" 2>&1 | tee -a "$LOG_FILE"
  EXIT_CODE=${PIPESTATUS[0]}
fi

echo "$(date -Is) EXITED:$LANE_NAME:$EXIT_CODE" | tee -a "$LOG_FILE"
exit "$EXIT_CODE"
