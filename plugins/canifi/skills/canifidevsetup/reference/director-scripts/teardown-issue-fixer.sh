#!/usr/bin/env bash
# teardown-issue-fixer.sh — kill the Auto Issue Fixer's ONE tmux session
# after its run is over (DONE confirmed, or force-teardown at the safety
# timeout). Scoped strictly to this one session name (+ tmux-group
# siblings) — same discipline as teardown-team.sh, never a
# kill-everything-except-an-allowlist sweep.
set -euo pipefail

SESSION=auto-issue-fixer

kill_matching() {
  local target="$1" line name group killed=0
  while IFS= read -r line; do
    name="${line%%:*}"
    group="${line#*:}"
    if [ "$name" = "$target" ] || { [ -n "$group" ] && [ "$group" = "$target" ]; }; then
      tmux kill-session -t "$name" 2>/dev/null && echo "KILLED  $name (matched '$target')" && killed=1
    fi
  done < <(tmux list-sessions -F '#{session_name}:#{session_group}' 2>/dev/null || true)
  [ "$killed" -eq 1 ] || echo "SKIP    $target (no such session — already gone)"
}

kill_matching "$SESSION"

# Safety net: same orphaned-background-process check as teardown-team.sh —
# a heartbeat/watcher started detached (nohup/disown-style) survives
# `tmux kill-session`. Kill by command-line match on the session name.
MATCHES="$(pgrep -f "$SESSION" 2>/dev/null || true)"
if [ -n "$MATCHES" ]; then
  echo "$MATCHES" | while read -r pid; do
    CMD="$(ps -p "$pid" -o command= 2>/dev/null || true)"
    echo "KILLED  orphaned background process $pid matching '$SESSION': ${CMD:0:80}"
    kill "$pid" 2>/dev/null || true
  done
fi

echo "teardown-issue-fixer complete."
