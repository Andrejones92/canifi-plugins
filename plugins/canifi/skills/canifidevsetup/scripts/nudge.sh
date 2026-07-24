#!/usr/bin/env bash
# Nudge a tmux session with a message (send-keys, then Enter separately so the
# line actually submits), then capture the pane to VERIFY the nudge landed.
# Usage: nudge.sh <session> <message...>
# Note: pass the message plain (no backticks — zsh/bash in the target pane will
# try command-substitution on them). Target the concrete session (e.g. lead-9),
# not a bare group name.
set -euo pipefail
S="${1:?usage: nudge.sh <session> <message>}"; shift
MSG="$*"
tmux send-keys -t "$S" "$MSG"
sleep 1
tmux send-keys -t "$S" Enter
sleep 2
echo "=== pane after nudge ($S) ==="
tmux capture-pane -pt "$S" -S -8 2>/dev/null | grep -v '^$' | tail -8
