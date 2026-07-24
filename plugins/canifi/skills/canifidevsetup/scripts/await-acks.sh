#!/usr/bin/env bash
# Lead: block until BOTH principals have ACKed a directive, or time out.
# Exit 0 = both acked; exit 2 = timeout (prints who is missing so you can
# re-nudge that session and capture-pane to check it's alive).
# Usage: await-acks.sh <acks_file> <directive_id> <timeout_secs> <sess1> <sess2>
set -euo pipefail
ACKS="${1:?acks_file}"; ID="${2:?directive_id}"; TIMEOUT="${3:-90}"
S1="${4:?sess1}"; S2="${5:?sess2}"
[ -f "$ACKS" ] || : > "$ACKS"
DEADLINE=$(( $(date +%s) + TIMEOUT ))
while :; do
  A1=$(grep -c "ACK ${ID} ${S1}" "$ACKS" 2>/dev/null || true); A1=${A1:-0}
  A2=$(grep -c "ACK ${ID} ${S2}" "$ACKS" 2>/dev/null || true); A2=${A2:-0}
  if [ "$A1" -ge 1 ] && [ "$A2" -ge 1 ]; then
    echo "BOTH ACKED ${ID}  (${S1}=$A1 ${S2}=$A2)"; exit 0
  fi
  if [ "$(date +%s)" -ge "$DEADLINE" ]; then
    echo "TIMEOUT ${ID}: ${S1}=${A1} ${S2}=${A2}  <- re-nudge whoever is 0"; exit 2
  fi
  sleep 3
done
