#!/usr/bin/env bash
# Idempotent tmux + Claude environment bootstrap. Safe to re-run: any session
# that already exists is left completely untouched (never restarted, never
# re-nudged), so re-running after a partial boot only fills in what's missing.
#
# Director on-demand model (2026-07): this script deliberately does NOT
# create any of the eight autoX rotations' 24 Lead/Principal sessions.
# Running all 24 Claude Code processes at once — even idle — froze this
# machine; the Director (tmux `director`) now spawns each team's 3 sessions
# fresh only for that team's activation and kills them right after (see
# ~/.claude/skills/director/SKILL.md and its spawn-team.sh/teardown-team.sh).
# Bootup's whole footprint is the user's general panes + director.
set -euo pipefail

FRESH=()

# Defensive, idempotent: the cross-rotation registry folder the Director and
# the eight autoX rotations read/write. Harmless if it already exists.
mkdir -p "$HOME/Documents/autoteam-registry"

# A session "exists" if its exact name matches OR it belongs to a tmux
# session GROUP with that name. Terminal apps with tmux integration (e.g.
# iTerm2) create numbered siblings within a group each time a new window
# attaches (documents-11, mini-2, lead-9 are all real examples on this
# machine) — `tmux has-session -t <name>` does NOT reliably catch these
# (it only prefix-matches, so "lead-engineer" does not match "lead-9"),
# which caused a real duplicate Lead session on the first version of this
# script. Always check groups, never rely on has-session alone.
session_exists() {
  local target="$1"
  tmux list-sessions -F '#{session_name}:#{session_group}' 2>/dev/null \
    | awk -F: -v n="$target" '$1==n || ($2!="" && $2==n) {found=1} END{exit !found}'
}

launch() {
  local name="$1" dir="$2" cont="$3" detect="${4:-$1}"
  if session_exists "$detect"; then
    echo "SKIP    $name (already exists, matched '$detect')"
    return
  fi
  mkdir -p "$dir"
  tmux new-session -d -s "$name" -c "$dir"
  local cmd="claude --dangerously-skip-permissions"
  if [ "$cont" = "yes" ]; then
    cmd="$cmd --continue"
  fi
  tmux send-keys -t "$name" "$cmd"
  sleep 1
  tmux send-keys -t "$name" Enter
  echo "STARTED $name -> $dir ($cmd)"
  FRESH+=("$name")
}

# name                    dir                                       --continue?
launch skills               "$HOME/.claude/skills"                    yes
launch documents             "$HOME/Documents"                         yes
launch mini                  "$HOME"                                   yes
launch exampleapp-marketing      "$HOME/Documents/exampleapp-marketing-site"   no

# --- director (on-demand spawn/teardown orchestrator for the 8 rotations) ---
launch director              "$HOME/Documents/director"                 no

# --- status dashboard (plain python3, NOT a Claude session — no skill to
# trigger, nothing to brief). Serves http://127.0.0.1:8787, exposed on the
# tailnet via `tailscale serve` (persists at the daemon level across
# reboots — only the python process itself needs relaunching here). See
# ~/Documents/exampleapp-dashboard/README.md.
if session_exists dashboard; then
  echo "SKIP    dashboard (already exists)"
else
  mkdir -p "$HOME/Documents/exampleapp-dashboard"
  tmux new-session -d -s dashboard -c "$HOME/Documents/exampleapp-dashboard"
  tmux send-keys -t dashboard "python3 server.py" Enter
  echo "STARTED dashboard -> $HOME/Documents/exampleapp-dashboard (python3 server.py)"
fi

is_fresh() {
  local target="$1"
  for s in "${FRESH[@]:-}"; do
    [ "$s" = "$target" ] && return 0
  done
  return 1
}

# Give freshly-launched Claude processes time to reach a ready prompt before
# sending the skill-trigger slash command. The footprint is small now (at
# most 5 fresh sessions), so a modest scaled wait suffices.
if [ "${#FRESH[@]:-0}" -gt 0 ]; then
  wait_secs=$(( 8 + 2 * ${#FRESH[@]} ))
  sleep "$wait_secs"
fi

# The director session, if (and only if) it was freshly created this run,
# gets /director sent once. The is_fresh guard means re-running bootup never
# re-triggers an already-running director.
#
# Robust submit: clear the input line first (C-u, in case a stale draft or an
# open autocomplete menu is present), type the command, Enter, then VERIFY the
# command left the input box; retry up to 3 times. This defeats the two
# observed failure modes — command text lost entirely, and command typed but
# the autocomplete menu swallowing the Enter so it never submits.
trigger_lead() {
  local session="$1" skill="$2" attempt pane
  if ! is_fresh "$session"; then
    return
  fi
  for attempt in 1 2 3; do
    tmux send-keys -t "$session" C-u
    sleep 1
    tmux send-keys -t "$session" "$skill"
    sleep 2
    tmux send-keys -t "$session" Enter
    sleep 3
    # If the command text is no longer sitting in the input box, it submitted.
    pane=$(tmux capture-pane -pt "$session" -S -6 2>/dev/null || true)
    if ! printf '%s' "$pane" | grep -qF "❯ $skill"; then
      echo "TRIGGERED $session -> $skill"
      return
    fi
  done
  echo "WARN: $session -> $skill may not have submitted after 3 attempts (check the pane)"
}

# ONLY the director gets an auto-trigger: it reads its skill and starts the
# round-robin, spawning/briefing/tearing down each rotation's trio itself.
trigger_lead director                    /director

echo "bootup complete."
