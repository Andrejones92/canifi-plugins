#!/usr/bin/env bash
# teardown-team.sh <team> — kill ONE autoX team's three tmux sessions (Lead,
# Web Principal, iOS Principal) after that team's activation is over.
#
# Scoped strictly by THIS team's session names (plus their tmux-group
# siblings) — it never touches the user's general panes, the director
# session, or any other team. It is deliberately NOT a "kill everything
# except an allowlist" sweep.
#
# Idempotent: killing a session that doesn't exist is a no-op (reported as
# SKIP). Safe to re-run after a partial teardown.
set -euo pipefail

TEAM="${1:?usage: teardown-team.sh <team>  (autoqa|autosecurity|autoaccessibility|autodesign|autoperf|autolocalization|autoresilience|autoanalytics|autointeroperability|autoparity)}"

case "$TEAM" in
  autoqa)             SESSIONS=(lead-engineer exampleapp exampleapp-ios) ;;
  autosecurity)       SESSIONS=(lead-security-engineer exwebsecurity exiossecurity) ;;
  autoaccessibility)  SESSIONS=(lead-accessibility-engineer exwebaccessibility exiosaccessibility) ;;
  autodesign)         SESSIONS=(lead-design-engineer exwebdesign exiosdesign) ;;
  autoperf)           SESSIONS=(lead-performance-engineer exwebperf exiosperf) ;;
  autolocalization)   SESSIONS=(lead-localization-engineer exweblocalization exioslocalization) ;;
  autoresilience)     SESSIONS=(lead-resilience-engineer exwebresilience exiosresilience) ;;
  autoanalytics)      SESSIONS=(lead-analytics-engineer exwebanalytics exiosanalytics) ;;
  autointeroperability) SESSIONS=(lead-interoperability-engineer exwebinteroperability exiosinteroperability) ;;
  autoparity)         SESSIONS=(lead-parity-engineer exwebparity exiosparity) ;;
  *) echo "ERROR: unknown team '$TEAM'" >&2; exit 1 ;;
esac

# Kill the exact-named session AND any numbered group siblings (iTerm2 tmux
# integration creates e.g. lead-9 in group lead-engineer/lead — the same
# group phenomenon the spawn-side existence check guards against). We match
# a session if its name OR its group equals the target name. Nothing else is
# ever matched, so the user's panes and other teams are structurally safe.
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

for s in "${SESSIONS[@]}"; do
  kill_matching "$s"
done

# Safety net: a Lead's heartbeat loop (or any other background watcher) is
# sometimes started detached (nohup/disown-style) rather than as a plain
# child of its tmux pane's shell — `tmux kill-session` does NOT reap those,
# so they can survive teardown indefinitely and misfire into the NEXT
# activation that reuses the same session names (this happened for real:
# three orphaned heartbeat loops from earlier activations were still
# running and pinging their old session names an hour-plus later). Kill by
# command-line match on each of this team's session names — safe because
# these are distinctive strings that only appear in this team's own
# scripts/nudges, never in unrelated processes.
for s in "${SESSIONS[@]}"; do
  MATCHES="$(pgrep -f "$s" 2>/dev/null || true)"
  if [ -n "$MATCHES" ]; then
    echo "$MATCHES" | while read -r pid; do
      CMD="$(ps -p "$pid" -o command= 2>/dev/null || true)"
      echo "KILLED  orphaned background process $pid matching '$s': ${CMD:0:80}"
      kill "$pid" 2>/dev/null || true
    done
  fi
done

echo "teardown-team $TEAM complete."
