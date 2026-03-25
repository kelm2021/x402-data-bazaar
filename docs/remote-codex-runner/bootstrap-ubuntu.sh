#!/usr/bin/env bash
set -euo pipefail

echo "[1/5] Installing apt packages..."
sudo apt update
sudo apt install -y git tmux curl jq unzip build-essential ripgrep ca-certificates gnupg

echo "[2/5] Installing Node.js 22..."
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

echo "[3/5] Installing global npm tools..."
npm install -g @openai/codex vercel ralphy-cli

echo "[4/5] Creating standard directories..."
mkdir -p "$HOME/work" "$HOME/ops" "$HOME/ops/logs" "$HOME/bin" "$HOME/.tmux" "$HOME/.codex" "$HOME/.agents"

echo "[5/5] Versions..."
node --version
npm --version
codex --version
vercel --version
ralphy --version || true

echo
echo "Bootstrap complete."
echo "Next:"
echo "  1. codex login"
echo "  2. copy ~/.codex/skills and ~/.agents/skills from your local machine"
echo "  3. cp docs/remote-codex-runner/agent.env.template ~/ops/agent.env"
