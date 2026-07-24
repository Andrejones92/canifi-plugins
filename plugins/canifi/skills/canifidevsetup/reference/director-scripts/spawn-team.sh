#!/usr/bin/env bash
# spawn-team.sh <team> — create ONE autoX team's three tmux sessions (Lead,
# Web Principal, iOS Principal) fresh and launch Claude in each.
#
# Director on-demand model: a team's sessions exist ONLY while that team is
# activated. The Director runs this immediately before activating a team and
# runs teardown-team.sh the moment the team's DONE + cleanup is confirmed.
# At steady state only ~4-7 Claude processes exist machine-wide (the user's
# general panes + director + at most ONE team's trio) — this bounded footprint
# is the whole point of the redesign (24 concurrent sessions froze the
# machine once; never recreate that).
#
# Idempotent: uses the same group-aware existence check as bootup.sh — a
# session "exists" if its exact name matches OR it belongs to a tmux session
# GROUP of that name. iTerm2's tmux integration creates numbered siblings
# within a group (documents-11, lead-9 are real examples on this machine);
# `tmux has-session -t <name>` only prefix-matches and missed a real session
# once, causing a genuine duplicate. Always check groups.
set -euo pipefail

TEAM="${1:?usage: spawn-team.sh <team>  (autoqa|autosecurity|autoaccessibility|autodesign|autoperf|autolocalization|autoresilience|autoanalytics|autointeroperability|autoparity)}"

# team -> "lead-session:lead-dir web-session ios-session"
# Session names/cwds come from each rotation's SKILL.md "Session bootstrap"
# table. Every web principal cwd = ~/Documents/exampleapp, every iOS principal
# cwd = ~/Documents/exampleapp-ios.
case "$TEAM" in
  autoqa)             LEAD=lead-engineer;               WEB=exampleapp;            IOS=exampleapp-ios ;;
  autosecurity)       LEAD=lead-security-engineer;      WEB=exwebsecurity;       IOS=exiossecurity ;;
  autoaccessibility)  LEAD=lead-accessibility-engineer; WEB=exwebaccessibility;  IOS=exiosaccessibility ;;
  autodesign)         LEAD=lead-design-engineer;        WEB=exwebdesign;         IOS=exiosdesign ;;
  autoperf)           LEAD=lead-performance-engineer;   WEB=exwebperf;           IOS=exiosperf ;;
  autolocalization)   LEAD=lead-localization-engineer;  WEB=exweblocalization;   IOS=exioslocalization ;;
  autoresilience)     LEAD=lead-resilience-engineer;    WEB=exwebresilience;     IOS=exiosresilience ;;
  autoanalytics)      LEAD=lead-analytics-engineer;     WEB=exwebanalytics;      IOS=exiosanalytics ;;
  autointeroperability) LEAD=lead-interoperability-engineer; WEB=exwebinteroperability; IOS=exiosinteroperability ;;
  autoparity)          LEAD=lead-parity-engineer;        WEB=exwebparity;         IOS=exiosparity ;;
  *) echo "ERROR: unknown team '$TEAM'" >&2; exit 1 ;;
esac

LEAD_DIR="$HOME/Documents/$LEAD"
WEB_DIR="$HOME/Documents/exampleapp"
IOS_DIR="$HOME/Documents/exampleapp-ios"

# Group-aware existence check (same as bootup.sh — see header comment).
session_exists() {
  local target="$1"
  tmux list-sessions -F '#{session_name}:#{session_group}' 2>/dev/null \
    | awk -F: -v n="$target" '$1==n || ($2!="" && $2==n) {found=1} END{exit !found}'
}

launch() {
  local name="$1" dir="$2"
  if session_exists "$name"; then
    echo "SKIP    $name (already exists — not double-creating)"
    return
  fi
  mkdir -p "$dir"
  tmux new-session -d -s "$name" -c "$dir"
  # No --continue: each session starts fresh and is briefed from the team's
  # shared folder, never from prior transcript history.
  # Explicit model pin: without this, the CLI falls back to whatever model
  # was last used in the terminal (observed drifting to Fable), not the
  # intended Sonnet-medium for the ten rotation teams. Only the issue-fixer
  # (spawn-issue-fixer.sh, separate script) should ever run Fable-low.
  tmux send-keys -t "$name" "claude --dangerously-skip-permissions --model sonnet --effort medium"
  sleep 1
  tmux send-keys -t "$name" Enter
  echo "STARTED $name -> $dir"
}

launch "$LEAD" "$LEAD_DIR"
launch "$WEB"  "$WEB_DIR"
launch "$IOS"  "$IOS_DIR"

echo "spawn-team $TEAM complete (lead=$LEAD web=$WEB ios=$IOS)."
echo "Give the fresh Claude processes ~15-20s to reach a ready prompt before briefing."
