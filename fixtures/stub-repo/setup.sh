#!/usr/bin/env bash
# setup.sh — materialize the stub-repo template into a real git repository.
#
# Usage:
#   setup.sh <target-dir>         # pass variant: echo ok  (exit 0)
#   setup.sh <target-dir> fail    # fail variant: exit 7   (exit 1 from stet)
#
# What it does:
#   1. Copies the template files to <target-dir>
#   2. git init -b main
#   3. Configures a local git user (no system/global config required)
#   4. Commits all files as the initial commit
#   5. Stages a small change to src/main.ts
#      (so scope detection finds staged changes — the M1 fixture scenario)
#
# After running: cd <target-dir> && node <stet-repo>/dist/cli.mjs --format json

set -euo pipefail

TEMPLATE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_DIR="${1:?Usage: setup.sh <target-dir> [fail]}"
VARIANT="${2:-pass}"

echo "Materializing stub-repo into: $TARGET_DIR"

# Copy template files
mkdir -p "$TARGET_DIR"
cp -r "$TEMPLATE_DIR/src" "$TARGET_DIR/"
cp "$TEMPLATE_DIR/stet.config.yml" "$TARGET_DIR/"

# Write the fail variant config if requested
if [ "$VARIANT" = "fail" ]; then
  cat > "$TARGET_DIR/stet.config.yml" <<'YAML'
phases:
  stub-det:
    command: "exit 7"
YAML
  echo "Wrote fail-variant stet.config.yml (command: exit 7)"
fi

# Initialise git repo
cd "$TARGET_DIR"
git init -b main
git config user.name "stet-test"
git config user.email "stet-test@example.com"

# Initial commit with all files
git add .
git commit -m "Initial commit"

# Stage a change so scope detection sees staged files
echo "" >> src/main.ts
git add src/main.ts

echo ""
echo "Stub repo ready in: $TARGET_DIR"
echo "Staged files: $(git diff --name-only --cached | tr '\n' ' ')"
echo ""
echo "Run: node <stet-repo>/dist/cli.mjs --format json"
