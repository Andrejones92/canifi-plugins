#!/usr/bin/env bash
# spawn-issue-fixer.sh — create the Auto Issue Fixer's ONE tmux session fresh
# and launch Claude in it.
#
# Unlike spawn-team.sh (Lead + Web Principal + iOS Principal, three
# sessions), the fixer is a single session: it hosts the `autoissuefixer`
# skill, which itself launches ONE `Workflow` call whose own background
# agent() calls do the real simulator/browser driving (not additional tmux
# sessions). Keeping this as one session — not three — is deliberate: the
# whole reason the Issue-Fixer Gate exists as its own spawned/torn-down
# session (rather than the Director calling the Workflow inline) is to keep
# that complexity OUT of the Director's own context, not to reintroduce more
# standing tmux processes than necessary.
#
# Idempotent: same group-aware existence check as spawn-team.sh/bootup.sh.
set -euo pipefail

SESSION=auto-issue-fixer
DIR="$HOME/Documents/auto-issue-fixer"

session_exists() {
  local target="$1"
  tmux list-sessions -F '#{session_name}:#{session_group}' 2>/dev/null \
    | awk -F: -v n="$target" '$1==n || ($2!="" && $2==n) {found=1} END{exit !found}'
}

if session_exists "$SESSION"; then
  echo "SKIP    $SESSION (already exists — not double-creating)"
else
  mkdir -p "$DIR"
  tmux new-session -d -s "$SESSION" -c "$DIR"
  # No --continue: starts fresh every run, briefed from
  # ~/.claude/skills/autoissuefixer/SKILL.md and this run's docsDir, never
  # from prior transcript history.
  # Explicit model pin: without this, the CLI falls back to whatever model
  # was last used in the terminal, not the intended tier for this session.
  # This OUTER session (the one holding the Workflow call, reading results,
  # posting journal comments) runs Sonnet-medium — distinct from the
  # Fable-tier models used INSIDE the Workflow's own agent() calls
  # (Triage/Fix/Review/Retest), which are configured separately in
  # issue-fixer-workflow.js and unaffected by this flag.
  tmux send-keys -t "$SESSION" "claude --dangerously-skip-permissions --model sonnet --effort medium"
  sleep 1
  tmux send-keys -t "$SESSION" Enter
  echo "STARTED $SESSION -> $DIR"
fi

echo "spawn-issue-fixer complete."
echo "Give the fresh Claude process ~15-20s to reach a ready prompt before briefing."
