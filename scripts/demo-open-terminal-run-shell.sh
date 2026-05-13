#!/usr/bin/env bash
set -euo pipefail

# Standalone demo:
# Open macOS Terminal.app and run a Tether PTY session command there.
#
# Usage:
#   scripts/demo-open-terminal-run-shell.sh
#   scripts/demo-open-terminal-run-shell.sh /path/to/project
#   scripts/demo-open-terminal-run-shell.sh /path/to/project 'tether run claude'

WORK_DIR="${1:-$PWD}"
COMMAND="${2:-tether run shell}"

osascript - "$WORK_DIR" "$COMMAND" <<'APPLESCRIPT'
on run argv
  set workDir to item 1 of argv
  set commandText to item 2 of argv
  set shellText to "cd " & quoted form of workDir & " && " & commandText

  tell application "Terminal"
    activate
    do script shellText
  end tell
end run
APPLESCRIPT

echo "Opened Terminal.app"
echo "Working directory: $WORK_DIR"
echo "Command: $COMMAND"
