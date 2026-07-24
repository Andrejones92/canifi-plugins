#!/usr/bin/env bash
# Principal: append an ACK line to the shared acks file the moment you RECEIVE a
# directive/plan (before you start acting on it), so the Lead knows it landed.
# Usage: ack.sh <acks_file> <my_session> <directive_id> [note...]
set -euo pipefail
ACKS="${1:?usage: ack.sh <acks_file> <my_session> <directive_id> [note]}"
ME="${2:?my_session}"
ID="${3:?directive_id}"
shift 3 || true
NOTE="${*:-}"
TS="$(date +%H:%M)"
echo "ACK ${ID} ${ME} ${TS} ${NOTE}" >> "$ACKS"
echo "wrote -> ACK ${ID} ${ME} ${TS} ${NOTE}"
