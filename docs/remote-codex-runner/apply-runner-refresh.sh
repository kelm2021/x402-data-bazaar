#!/usr/bin/env bash
set -euo pipefail

PACKAGE_ROOT="${1:-/mnt/c/Users/Administrator/runner-refresh}"
REPO_DIR="${2:-$HOME/work/x402-data-bazaar}"
OPS_DIR="${3:-$HOME/ops}"
RESTART_LOOP="${4:-1}"

if [ ! -d "$PACKAGE_ROOT" ]; then
  echo "Package root not found: $PACKAGE_ROOT" >&2
  exit 1
fi

mkdir -p "$REPO_DIR/docs/remote-codex-runner"
mkdir -p "$REPO_DIR/scripts"
mkdir -p "$REPO_DIR/test"
mkdir -p "$REPO_DIR/apps/restricted-party-screen"
mkdir -p "$REPO_DIR/apps/vendor-entity-brief"

cp -R "$PACKAGE_ROOT"/docs/remote-codex-runner/. "$REPO_DIR"/docs/remote-codex-runner/
if [ -d "$PACKAGE_ROOT/scripts" ]; then
  cp -R "$PACKAGE_ROOT"/scripts/. "$REPO_DIR"/scripts/
fi
if [ -f "$PACKAGE_ROOT/app.js" ]; then
  cp "$PACKAGE_ROOT/app.js" "$REPO_DIR/app.js"
fi
if [ -f "$PACKAGE_ROOT/business-dashboard.js" ]; then
  cp "$PACKAGE_ROOT/business-dashboard.js" "$REPO_DIR/business-dashboard.js"
fi
if [ -f "$PACKAGE_ROOT/index.js" ]; then
  cp "$PACKAGE_ROOT/index.js" "$REPO_DIR/index.js"
fi
if [ -f "$PACKAGE_ROOT/package.json" ]; then
  cp "$PACKAGE_ROOT/package.json" "$REPO_DIR/package.json"
fi
if [ -f "$PACKAGE_ROOT/test/business-dashboard.test.js" ]; then
  cp "$PACKAGE_ROOT/test/business-dashboard.test.js" "$REPO_DIR/test/business-dashboard.test.js"
fi
cp -R "$PACKAGE_ROOT"/apps/restricted-party-screen/. "$REPO_DIR"/apps/restricted-party-screen/
cp -R "$PACKAGE_ROOT"/apps/vendor-entity-brief/. "$REPO_DIR"/apps/vendor-entity-brief/

if [ -f "$PACKAGE_ROOT/metrics.js" ]; then
  cp "$PACKAGE_ROOT/metrics.js" "$REPO_DIR/metrics.js"
fi

bash "$REPO_DIR/docs/remote-codex-runner/install-business-os.sh" "$REPO_DIR" "$OPS_DIR"
cp "$REPO_DIR/docs/remote-codex-runner/eom-revenue-2026-03-31.md" "$OPS_DIR/eom-revenue-2026-03-31.md"

if [ "$RESTART_LOOP" = "1" ]; then
  tmux -S "$HOME/.tmux/sock" kill-session -t eom-revenue 2>/dev/null || true
  bash "$HOME/bin/start-eom-loop.sh"
fi

echo "Runner refresh applied from $PACKAGE_ROOT"
