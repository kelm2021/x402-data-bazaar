#!/usr/bin/env bash
set -euo pipefail

SOURCE_OS_DIR="${1:-$HOME/ops/business-os}"
SOURCE_REPO_DIR="${2:-$HOME/work/x402-data-bazaar}"
PUBLISH_REPO_DIR="${3:-$HOME/work/x402-data-bazaar-dashboard-publisher}"
BRANCH="${DASHBOARD_PUBLISH_BRANCH:-}"
VERCEL_PROJECT="${BUSINESS_DASHBOARD_VERCEL_PROJECT:-x402-data-bazaar}"
VERCEL_SCOPE="${BUSINESS_DASHBOARD_VERCEL_SCOPE:-}"

if [[ ! -d "$SOURCE_OS_DIR" ]]; then
  echo "Missing business OS directory: $SOURCE_OS_DIR" >&2
  exit 1
fi

if [[ ! -d "$SOURCE_REPO_DIR/.git" ]]; then
  echo "Missing source repo git directory: $SOURCE_REPO_DIR" >&2
  exit 1
fi

REMOTE_URL="$(git -C "$SOURCE_REPO_DIR" config --get remote.origin.url || true)"
if [[ -z "$REMOTE_URL" ]]; then
  echo "Missing remote.origin.url in $SOURCE_REPO_DIR" >&2
  exit 1
fi

if [[ -z "$BRANCH" ]]; then
  BRANCH="$(git -C "$SOURCE_REPO_DIR" rev-parse --abbrev-ref HEAD)"
  if [[ "$BRANCH" == "HEAD" ]]; then
    BRANCH="$(git -C "$SOURCE_REPO_DIR" symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##' || true)"
  fi
fi

BRANCH="${BRANCH:-main}"

if [[ ! -d "$PUBLISH_REPO_DIR/.git" ]]; then
  git clone --branch "$BRANCH" "$REMOTE_URL" "$PUBLISH_REPO_DIR"
else
  git -C "$PUBLISH_REPO_DIR" fetch origin "$BRANCH"
  git -C "$PUBLISH_REPO_DIR" checkout "$BRANCH"
  git -C "$PUBLISH_REPO_DIR" pull --rebase origin "$BRANCH"
fi

git -C "$PUBLISH_REPO_DIR" config user.name >/dev/null 2>&1 || git -C "$PUBLISH_REPO_DIR" config user.name "${DASHBOARD_GIT_USER_NAME:-Codex Runner}"
git -C "$PUBLISH_REPO_DIR" config user.email >/dev/null 2>&1 || git -C "$PUBLISH_REPO_DIR" config user.email "${DASHBOARD_GIT_USER_EMAIL:-codex-runner@local}"

for relative_path in \
  "app.js" \
  "business-dashboard.js" \
  "index.js" \
  "metrics.js" \
  "package.json" \
  "test/business-dashboard.test.js"
do
  source_path="$SOURCE_REPO_DIR/$relative_path"
  destination_path="$PUBLISH_REPO_DIR/$relative_path"
  if [[ -f "$source_path" ]]; then
    mkdir -p "$(dirname "$destination_path")"
    cp "$source_path" "$destination_path"
  fi
done

node "$SOURCE_REPO_DIR/scripts/build_business_dashboard_snapshot.js" \
  --source-dir "$SOURCE_OS_DIR" \
  --output-dir "$PUBLISH_REPO_DIR/ops-dashboard" \
  --repo-root "$PUBLISH_REPO_DIR"

git -C "$PUBLISH_REPO_DIR" add \
  app.js \
  business-dashboard.js \
  index.js \
  metrics.js \
  package.json \
  test/business-dashboard.test.js \
  ops-dashboard

if git -C "$PUBLISH_REPO_DIR" diff --cached --quiet; then
  echo "No business dashboard changes to publish."
  exit 0
fi

git -C "$PUBLISH_REPO_DIR" commit -m "ops: refresh business dashboard snapshot"
git -C "$PUBLISH_REPO_DIR" push origin "$BRANCH"

echo "Published business dashboard snapshot on branch $BRANCH"

if [[ "${BUSINESS_DASHBOARD_DEPLOY:-1}" == "1" ]]; then
  if [[ -z "${VERCEL_TOKEN:-}" ]]; then
    echo "Skipping Vercel deploy because VERCEL_TOKEN is not set." >&2
    exit 0
  fi

  pushd "$PUBLISH_REPO_DIR" >/dev/null
  VERCEL_LINK_ARGS=(--project "$VERCEL_PROJECT" --yes --token "$VERCEL_TOKEN")
  VERCEL_DEPLOY_ARGS=(--prod --yes --token "$VERCEL_TOKEN")
  if [[ -n "$VERCEL_SCOPE" ]]; then
    VERCEL_LINK_ARGS+=(--scope "$VERCEL_SCOPE")
    VERCEL_DEPLOY_ARGS+=(--scope "$VERCEL_SCOPE")
  fi

  vercel link "${VERCEL_LINK_ARGS[@]}"
  vercel deploy "${VERCEL_DEPLOY_ARGS[@]}"
  popd >/dev/null
fi
