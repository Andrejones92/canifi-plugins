#!/usr/bin/env bash
# Lead: watch BOTH principals' current-round log files at once; print the tail of
# whichever changes first, then exit (re-launch to keep monitoring). Lets the
# Lead react to either engineer without burning a turn polling.
# ALWAYS pass a timeout — an untimed watch blocks forever if both files already
# reached their awaited state before this script took its baseline (e.g. both
# Principals finished and went idle before the Lead started watching). On
# timeout this exits 2 and prints CURRENT tails of both files anyway, so the
# caller can see present state and decide instead of staying blind.
# Usage: monitor-peers.sh <fileA> <fileB> [interval=5] [tail=40] [timeout_secs=300]
set -euo pipefail
A="${1:?fileA}"; B="${2:?fileB}"; INT="${3:-5}"; TAIL="${4:-40}"; TIMEOUT="${5:-300}"
hashof(){ md5 -q "$1" 2>/dev/null || md5sum "$1" 2>/dev/null | cut -d' ' -f1; }
for f in "$A" "$B"; do [ -f "$f" ] || : > "$f"; done
HA="$(hashof "$A")"; HB="$(hashof "$B")"
ELAPSED=0
while :; do
  CA="$(hashof "$A")"; CB="$(hashof "$B")"
  if [ "$CA" != "$HA" ]; then echo "=== CHANGED: $A ==="; tail -n "$TAIL" "$A"; exit 0; fi
  if [ "$CB" != "$HB" ]; then echo "=== CHANGED: $B ==="; tail -n "$TAIL" "$B"; exit 0; fi
  if [ "$TIMEOUT" -gt 0 ] && [ "$ELAPSED" -ge "$TIMEOUT" ]; then
    echo "=== TIMEOUT after ${TIMEOUT}s, neither file changed ==="
    echo "=== current tail of $A (re-check directly — the awaited event may have already happened before this watch started) ==="
    tail -n "$TAIL" "$A"
    echo "=== current tail of $B ==="
    tail -n "$TAIL" "$B"
    exit 2
  fi
  sleep "$INT"
  ELAPSED=$((ELAPSED + INT))
done
