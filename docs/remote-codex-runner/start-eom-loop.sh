#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${ENV_FILE:-$HOME/ops/agent.env}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing env file: $ENV_FILE"
  exit 1
fi

set -a
source "$ENV_FILE"
set +a

export PATH="/usr/local/bin:/usr/bin:$HOME/.npm-global/bin:$PATH"

OPS_DIR="${OPS_DIR:-$HOME/ops}"
REPO_DIR="${REPO_DIR:-$HOME/work/x402-data-bazaar}"
MISSION_FILE="${MISSION_FILE:-$OPS_DIR/eom-revenue-2026-03-31.md}"
SESSION_NAME="${SESSION_NAME:-eom-revenue}"
SOCK="${SOCK:-$HOME/.tmux/sock}"
LOG_DIR="$OPS_DIR/logs"
LOG_FILE="$LOG_DIR/${SESSION_NAME}.log"

mkdir -p "$LOG_DIR" "$HOME/.tmux" "$HOME/bin"

if [[ -n "${GIT_AUTHOR_NAME:-}" ]]; then
  git config --global user.name "$GIT_AUTHOR_NAME"
fi

if [[ -n "${GIT_AUTHOR_EMAIL:-}" ]]; then
  git config --global user.email "$GIT_AUTHOR_EMAIL"
fi

if tmux -S "$SOCK" has-session -t "$SESSION_NAME" 2>/dev/null; then
  echo "tmux session already exists: $SESSION_NAME"
  exit 0
fi

if [[ ! -d "$REPO_DIR" ]]; then
  echo "Missing repo directory: $REPO_DIR"
  exit 1
fi

if [[ ! -f "$MISSION_FILE" ]]; then
  echo "Missing mission file: $MISSION_FILE"
  exit 1
fi

tmux -S "$SOCK" new -d -s "$SESSION_NAME" \
"export PATH=/usr/local/bin:/usr/bin:\$HOME/.npm-global/bin:\$PATH; \
 set -a; source '$ENV_FILE'; set +a; \
 mkdir -p '$LOG_DIR'; \
 cd '$REPO_DIR' && \
 echo \$(date -Is) STARTING '$SESSION_NAME' | tee -a '$LOG_FILE'; \
 ralphy --codex --prd '$MISSION_FILE'; \
 EXIT_CODE=\$?; \
 echo \$(date -Is) EXITED:\$EXIT_CODE | tee -a '$LOG_FILE'; \
 sleep 999999"

echo "Started tmux session: $SESSION_NAME"
echo "Inspect with:"
echo "  tmux -S $SOCK capture-pane -t $SESSION_NAME -p | tail -50"
