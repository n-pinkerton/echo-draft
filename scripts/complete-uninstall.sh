#!/usr/bin/env bash

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "This script will stop EchoDraft, remove the installed app, and delete caches, databases, and preferences."
read -r -p "Continue with the full uninstall? [y/N]: " confirm
if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
  echo "Aborted."
  exit 0
fi

remove_target() {
  local target="$1"
  if [[ -e "$target" ]]; then
    echo "Removing $target"
    rm -rf "$target" 2>/dev/null || sudo rm -rf "$target"
  fi
}

echo "Stopping running EchoDraft/Electron processes..."
pkill -f "EchoDraft" 2>/dev/null || true
pkill -f "Electron Helper.*EchoDraft" 2>/dev/null || true

echo "Removing /Applications/EchoDraft.app (requires admin)..."
remove_target "/Applications/EchoDraft.app"

echo "Purging Application Support data..."
remove_target "$HOME/Library/Application Support/EchoDraft"
remove_target "$HOME/Library/Application Support/EchoDraft-dev"

echo "Removing caches, logs, and saved state..."
remove_target "$HOME/Library/Caches/echodraft"
remove_target "$HOME/Library/Caches/com.herotools.echodraft"
remove_target "$HOME/Library/Preferences/com.herotools.echodraft.plist"
remove_target "$HOME/Library/Preferences/com.herotools.echodraft.helper.plist"
remove_target "$HOME/Library/Logs/EchoDraft"
remove_target "$HOME/Library/Saved Application State/com.herotools.echodraft.savedState"

echo "Cleaning temporary files..."
shopt -s nullglob
for tmp in /tmp/echodraft*; do
  remove_target "$tmp"
done
for crash in "$HOME/Library/Application Support/CrashReporter"/EchoDraft_*; do
  remove_target "$crash"
done
shopt -u nullglob

read -r -p "Remove downloaded Whisper models and caches (~/.cache/whisper, ~/Library/Application Support/whisper)? [y/N]: " wipe_models
if [[ "$wipe_models" =~ ^[Yy]$ ]]; then
  remove_target "$HOME/.cache/whisper"
  remove_target "$HOME/Library/Application Support/whisper"
  remove_target "$HOME/Library/Application Support/EchoDraft/models"
fi

ENV_FILE="$PROJECT_ROOT/.env"
if [[ -f "$ENV_FILE" ]]; then
  read -r -p "Remove the local environment file at $ENV_FILE? [y/N]: " wipe_env
  if [[ "$wipe_env" =~ ^[Yy]$ ]]; then
    echo "Removing $ENV_FILE"
    rm -f "$ENV_FILE"
  fi
fi

cat <<'EOF'
macOS keeps microphone, screen recording, and accessibility approvals even after files are removed.
Reset them if you want a truly fresh start:
  tccutil reset Microphone com.herotools.echodraft
  tccutil reset Accessibility com.herotools.echodraft
  tccutil reset ScreenCapture com.herotools.echodraft

Full uninstall complete. Reboot if you removed permissions, then reinstall or run npm scripts on a clean tree.
EOF
