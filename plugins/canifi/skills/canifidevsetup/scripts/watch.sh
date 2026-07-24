#!/usr/bin/env bash
# Watch ONE file for changes (cheap md5 poll) and print its new tail on change,
# then exit. Run via a background-shell mechanism so completion notifies you.
# ALWAYS pass a timeout — an untimed watcher blocks forever if the awaited
# change already happened before this script took its baseline (the file
# never changes again and you never find out). On timeout this exits 2 and
# prints the file's CURRENT tail anyway, so the caller can see present state
# and decide (re-watch, re-nudge, or proceed) instead of staying blind.
# Usage: watch.sh <file> [interval_secs=5] [tail_lines=50] [timeout_secs=300]
set -euo pipefail
FILE="${1:?usage: watch.sh <file> [interval] [tail_lines] [timeout_secs]}"
INTERVAL="${2:-5}"
TAIL="${3:-50}"
TIMEOUT="${4:-300}"
hashof(){ md5 -q "$1" 2>/dev/null || md5sum "$1" 2>/dev/null | cut -d' ' -f1; }
[ -f "$FILE" ] || : > "$FILE"
BASELINE="$(hashof "$FILE")"
ELAPSED=0
while :; do
  CUR="$(hashof "$FILE")"
  if [ "$CUR" != "$BASELINE" ]; then
    echo "=== CHANGED: $FILE ==="
    tail -n "$TAIL" "$FILE"
    exit 0
  fi
  if [ "$TIMEOUT" -gt 0 ] && [ "$ELAPSED" -ge "$TIMEOUT" ]; then
    echo "=== TIMEOUT after ${TIMEOUT}s, no change detected: $FILE ==="
    echo "=== current tail (re-check this directly — the awaited event may have already happened before this watch started) ==="
    tail -n "$TAIL" "$FILE"
    exit 2
  fi
  sleep "$INTERVAL"
  ELAPSED=$((ELAPSED + INTERVAL))
done
