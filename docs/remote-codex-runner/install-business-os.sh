#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="${1:-$HOME/work/x402-data-bazaar}"
OPS_DIR="${2:-$HOME/ops}"

SEED_DIR="$REPO_DIR/docs/remote-codex-runner/business-os-seed"
DEST_DIR="$OPS_DIR/business-os"

mkdir -p "$DEST_DIR"

if [ -d "$SEED_DIR" ]; then
  cp -R "$SEED_DIR"/. "$DEST_DIR"/
fi

echo "Installed business OS seed into $DEST_DIR"
