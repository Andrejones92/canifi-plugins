---
name: bootup
description: Idempotently stand up this machine's standing tmux environment — the general-purpose "skills", "documents", "mini" Claude sessions (with --continue), "exampleapp-marketing", the "director" round-robin orchestrator session (auto-triggers /director), and the plain-python3 "dashboard" status-page session (no Claude, no skill trigger — just serves the live status dashboard on :8787, exposed on the tailnet via `tailscale serve`). Deliberately does NOT create any of the eight autoX rotations' 24 Lead/Principal sessions — the Director spawns each team's trio on demand and kills it after its activation (24 always-on sessions froze the machine once). Use when the user says "bootup", "boot up my sessions", "start my environment", or after a machine restart when the usual tmux sessions are gone.
version: 2.1.0
---

# Bootup — standing environment bootstrap

Recreates this machine's small standing set of tmux sessions, each running
Claude Code, so the day-to-day working environment is back up after a
restart or a killed session — without disturbing anything already running.

**Why the footprint is deliberately small (don't "fix" this):** an earlier
version of this script pre-created all eight autoX rotations' sessions —
8 Leads + 16 Principals = 24 Claude Code processes — and even mostly-idle,
they consumed enough RAM to **freeze the machine**. Under the Director
on-demand model, bootup creates only the general panes plus the `director`
session; the Director (see `~/.claude/skills/director/SKILL.md` and its
`spawn-team.sh` / `teardown-team.sh`) spawns a team's three sessions fresh
only for that team's activation and kills them immediately after. Steady
state machine-wide is ~4-7 Claude processes: the general panes, `director`,
and at most ONE active team's trio.

## What it creates

Run `~/.claude/skills/bootup/scripts/bootup.sh`. It is **fully idempotent**:
for each session it checks whether a session by that exact name exists, OR
whether one belongs to a tmux session **group** of that name — terminal
apps with tmux integration (iTerm2) create numbered sibling sessions within
a group each time a new window attaches (e.g. the real "documents" pane on
this machine is literally named `documents-11`, in group `documents`).
Checking only the exact name is not enough — an early version of this
script missed a real session that way and created a genuine duplicate.
Only genuinely missing sessions are created; existing ones are never
restarted or re-nudged. This means bootup is always safe to run.

| Session | Directory | Flags |
| --- | --- | --- |
| `skills` | `~/.claude/skills` | `--dangerously-skip-permissions --continue` |
| `documents` | `~/Documents` | `--dangerously-skip-permissions --continue` |
| `mini` | `~` (home) | `--dangerously-skip-permissions --continue` |
| `exampleapp-marketing` | `~/Documents/exampleapp-marketing-site` | `--dangerously-skip-permissions` |
| `director` | `~/Documents/director` | `--dangerously-skip-permissions` |
| `dashboard` | `~/Documents/exampleapp-dashboard` | *(none — plain `python3 server.py`, not a Claude session)* |

Only `skills`, `documents`, and `mini` get `--continue` — they're
general-purpose panes meant to resume prior context. The script also
`mkdir -p`s `~/Documents/autoteam-registry` (the shared registry the
Director and the eight rotations read/write — still needed even though the
rotation sessions themselves are no longer pre-created here).

`dashboard` is the odd one out: it runs `python3 server.py`, not Claude at
all — a small dependency-free status page (see
`~/Documents/exampleapp-dashboard/README.md`) reading `REGISTRY.md`/
`DIRECTOR-STATE.md`/`DISCUSSIONS.md` plus live `gh` data, served on
`127.0.0.1:8787` and exposed on the tailnet at
`https://example-host.your-tailnet.ts.net/` via `tailscale serve --bg`
(that proxy config persists at the tailscaled daemon level across
reboots — only the python process itself needs bootup to relaunch it).

## Skill triggers

**Only the `director` session gets an auto-trigger.** If (and only if)
`director` was freshly created this run, the script waits for Claude to
reach a ready prompt and sends it the literal `/director` slash command
(guarded by `is_fresh`, via the `trigger_lead` helper with its
verify-and-retry submit logic):

| Session | Slash command |
| --- | --- |
| `director` | `/director` |

That single trigger starts the whole autoX system: the Director picks up
the round-robin (autoqa first on a fresh state), spawns the active team's
three sessions itself, briefs them, activates the Lead for two cycles,
verifies cleanup, tears the trio down, and moves to the next team. Bootup
never creates, briefs, or triggers any rotation Lead or Principal.

`skills`, `documents`, `mini`, and `exampleapp-marketing` have no skill
trigger — they're launched idle for the user to drive directly.

## Running it

Just execute the script — no arguments, no interactive prompts:

```bash
~/.claude/skills/bootup/scripts/bootup.sh
```

It prints `SKIP <name> (already exists)` for sessions left alone and
`STARTED <name> -> <dir> (<cmd>)` for ones it created, followed by any
`TRIGGERED <name> -> /<skill>` lines. Report this output back to the user
rather than re-deriving it — it's the authoritative record of what actually
happened this run.

## When adding a new standing session later

Add one `launch <name> <dir> <yes|no>` line to `scripts/bootup.sh` (the
third argument controls `--continue`) and, if it should also have a skill
trigger, mirror the `is_fresh` / `trigger_lead` block at the bottom of the
script. Update the table above to match. Do NOT re-add the autoX rotation
sessions here — that's the Director's job, on demand, for the reason at the
top of this file.
