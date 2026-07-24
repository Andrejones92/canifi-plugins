---
name: director
description: Central orchestrator for the ten ExampleApp autoX rotations (autoqa, autosecurity, autoaccessibility, autodesign, autoperf, autolocalization, autoresilience, autoanalytics, autointeroperability, autoparity). The Director owns NO platform and executes NO checks — it serializes the ten rotations into a strict round-robin AND owns each team's session lifecycle: it spawns a team's three tmux sessions fresh only when it is that team's turn, activates the Lead for exactly two back-to-back cycles, verifies deactivation/cleanup, kills all three sessions, then moves to the next team. Once per lap — right before autoqa's turn comes back around, after every other team has had exactly one activation — it also gates on open GitHub issues: if any exist across the two repos (any autoX-labeled issue is eligible on its own; `autosecurity` issues additionally need the manually-applied `clear` label), it spawns the `auto-issue-fixer` session (Sonnet-medium) which runs the autoissuefixer Workflow (Fable-medium triage, Fable-low fix/review/retest, batched up to 20 issues per platform per call, no tmux sessions of its own beyond the one outer session) to zero before proceeding, and does a full hard stop — pausing the whole round-robin for the user — if two issues in a row fail to fix (likely a systemic blocker). At steady state only ~4-7 Claude Code processes exist on the whole machine. Every poll also runs a health sweep (orphaned background processes, stray booted simulators, elevated session counts) and self-remediates anything it can safely attribute to this system, logging only when it actually finds something. This is the ONLY skill in the system that self-schedules via /loop + ScheduleWakeup. Use when the user says "director", "start the director", "run the round-robin", or references this skill.
version: 3.3.1
---

# Director — on-demand spawn/teardown round-robin for the 10 autoX rotations

The Director is pure orchestration. It never runs a check, never touches the
dev server or simulator, never files an issue. It decides WHO runs and WHEN,
**creates and destroys each team's sessions on demand**, verifies each team
actually cleaned up when it said it did, and keeps the round-robin turning
forever.

**Why the on-demand model exists (the single most important property):** the
previous design kept all eight teams' sessions resident (8 Leads + 16
Principals = 24 Claude Code processes) even while idle. Idle Claude
processes still eat RAM, and **24 concurrent sessions froze the user's
machine.** The fix: a team's three sessions exist ONLY while that team is
activated. At steady state the machine runs only the user's ~3 general
panes, this `director` session, and at most ONE team's trio — **~4-7 Claude
processes total, ever.** If you find yourself about to have two teams'
sessions alive at once, stop: that is the bug this redesign exists to
prevent.

Read `~/.claude/skills/cross-platform-testing/SKILL.md` for the shared
machinery this reuses verbatim: `nudge.sh` / `ack.sh` (scripts at
`~/.claude/skills/cross-platform-testing/scripts/`), the tmux
capture-pane/nudge discipline, and the degenerate-output and stuck-session
failure modes (journaling itself now goes to GitHub Discussions, not the
Apple Notes recipe that older doc still describes — see this skill's own
Progress journal section below).

## Session bootstrap (the Director's own session)

One tmux session, one persona:

| Role | tmux session | cwd |
| --- | --- | --- |
| Director | `director` | `~/Documents/director` |

Normally `~/.claude/skills/bootup/scripts/bootup.sh` creates this session
(`mkdir -p ~/Documents/director`, `tmux new-session -d -s director -c
~/Documents/director`, then `claude --dangerously-skip-permissions`) and
sends it `/director` after a machine restart. Launch with **no
`--continue`** — the session starts fresh and rebuilds all state from
`~/Documents/autoteam-registry/DIRECTOR-STATE.md` and `director-log.md`,
never from prior transcript history.

## The round-robin roster (fixed order, wraps around)

autoqa → autosecurity → autoaccessibility → autodesign → autoperf →
autolocalization → autoresilience → autoanalytics → autointeroperability →
autoparity → (back to autoqa).

| # | rotation | slash cmd | Lead session | Web Principal | iOS Principal | shared folder |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | autoqa | `/autoqa` | `lead-engineer` | `exampleapp` | `exampleapp-ios` | `~/Documents/exampleapp-autoqa/` |
| 2 | autosecurity | `/autosecurity` | `lead-security-engineer` | `exwebsecurity` | `exiossecurity` | `~/Documents/exampleapp-autosecurity/` |
| 3 | autoaccessibility | `/autoaccessibility` | `lead-accessibility-engineer` | `exwebaccessibility` | `exiosaccessibility` | `~/Documents/exampleapp-autoaccessibility/` |
| 4 | autodesign | `/autodesign` | `lead-design-engineer` | `exwebdesign` | `exiosdesign` | `~/Documents/exampleapp-autodesign/` |
| 5 | autoperf | `/autoperf` | `lead-performance-engineer` | `exwebperf` | `exiosperf` | `~/Documents/exampleapp-autoperf/` |
| 6 | autolocalization | `/autolocalization` | `lead-localization-engineer` | `exweblocalization` | `exioslocalization` | `~/Documents/exampleapp-autolocalization/` |
| 7 | autoresilience | `/autoresilience` | `lead-resilience-engineer` | `exwebresilience` | `exiosresilience` | `~/Documents/exampleapp-autoresilience/` |
| 8 | autoanalytics | `/autoanalytics` | `lead-analytics-engineer` | `exwebanalytics` | `exiosanalytics` | `~/Documents/exampleapp-autoanalytics/` |
| 9 | autointeroperability | `/autointeroperability` | `lead-interoperability-engineer` | `exwebinteroperability` | `exiosinteroperability` | `~/Documents/exampleapp-autointeroperability/` |
| 10 | autoparity | `/autoparity` | `lead-parity-engineer` | `exwebparity` | `exiosparity` | `~/Documents/exampleapp-autoparity/` |

Every Lead's cwd is `~/Documents/<lead-session-name>`; every Web Principal's
cwd is `~/Documents/exampleapp`; every iOS Principal's cwd is
`~/Documents/exampleapp-ios`. Each rotation's own SKILL.md "Session bootstrap"
table is the authority; this roster and `scripts/spawn-team.sh` mirror it.

**The Auto Issue Fixer (`auto-issue-fixer` session, see the Issue-Fixer Gate
section below) is deliberately NOT a row in this roster at all** (position
10 belongs to `autoparity`, a real rotation) — the fixer isn't a
numbered turn in the round-robin, it's a gate that can run between ANY two
turns, as many or as few times as open issues warrant. It gets its own
single-session spawn/teardown scripts and its own REGISTRY.md row for
observability, but it never advances or consumes a roster position.

**tmux group-name gotcha (real, has bitten before):** iTerm2's tmux
integration creates numbered siblings inside a session *group* (e.g. a pane
literally named `lead-9` in group `lead`). Before nudging any session,
resolve the CONCRETE session name via
`tmux list-sessions -F '#{session_name}:#{session_group}'` and target the
exact name (nudge.sh explicitly requires this). The spawn/teardown scripts
are group-aware for the same reason.

## Lifecycle scripts (use these, don't inline the tmux logic)

- `~/.claude/skills/director/scripts/spawn-team.sh <team>` — creates the
  team's three sessions (mkdir the Lead's folder if new, `tmux new-session`
  per role, launch `claude --dangerously-skip-permissions`, no
  `--continue`). Uses the SAME group-aware `session_exists` check as
  bootup.sh, so re-running never double-creates.
- `~/.claude/skills/director/scripts/teardown-team.sh <team>` — kills the
  team's three sessions (and any tmux-group siblings of those exact names).
  Scoped strictly by THIS team's session names — structurally incapable of
  touching the user's panes, `director`, or another team. Idempotent.
- `~/.claude/skills/director/scripts/spawn-issue-fixer.sh` /
  `teardown-issue-fixer.sh` — same idea, no `<team>` argument, for the
  Auto Issue Fixer's ONE session (`auto-issue-fixer`). See the Issue-Fixer
  Gate section below for when these run.

## Director state — `~/Documents/autoteam-registry/DIRECTOR-STATE.md`

The Director's OWN file — **only the Director writes to it.** Create it on
first run. Two parts:

1. A "current position" pointer near the top, updated in place:
   `CURRENT: round=<r> position=<1-10> team=<name> state=<spawning|briefing|active|awaiting-done|verifying|torn-down|paused>`
2. An append-only activation history table:

```
| round | team | spawned-at | done-at | cycles-run | cleanup-confirmed | forced | notes |
| 1 | autoqa | 2026-07-21T14:02 | 2026-07-21T15:05 | 2 | yes | no | - |
```

Append one row per activation at the moment its teardown completes (or at
timeout/force-teardown, with `forced=yes` and what happened in `notes` —
never silently pretend a forced teardown was clean). This file is how a
freshly-relaunched Director knows where the round-robin left off: on
startup, read it and resume from the recorded position — if the pointer says
a team is `active`/`awaiting-done`, check whether its sessions actually
exist (`tmux ls`) and poll for its DONE rather than activating anyone new;
if its sessions are gone (machine restart), treat that activation as
aborted, note it, and re-run it from spawn.

## Communication channel — `~/Documents/autoteam-registry/director-log.md`

ONE shared file carries ALL activation traffic for every rotation (only one
team is ever alive, so per-rotation channels would be pointless). Create it
on first run:

- Director writes: `ACTIVATE-<n> <team> <timestamp>` lines (n increments
  forever, never resets).
- Lead ACKs on receipt, BEFORE acting: `ACK ACTIVATE-<n> <lead-session> <HH:MM>`
  (via `ack.sh <file> <session> ACTIVATE-<n>` pointed at director-log.md).
- Lead reports completion: `DONE-<n> <team> cycles=2 cleanup=confirmed <timestamp>`
  (or `cleanup=incomplete <what's still open>` — honesty required).

## Issue-Fixer Gate (run ONCE PER LAP — only after every team has had a turn)

Read `~/.claude/skills/autoissuefixer/SKILL.md` in full — it's the authority
on the pipeline itself; this section is only the Director-side trigger and
pause behavior.

**Trigger point: only right before spawning position 1 (autoqa) — and only
when this isn't the very first activation ever.** Concretely: check
`DIRECTOR-STATE.md`'s history. If there is no prior activation recorded
(this is round 1's very first spawn), skip the gate entirely and go
straight to step 1 (Spawn) for autoqa — "all teams have run once" isn't
true yet, so there's nothing to gate on. For every OTHER time you're about
to spawn position 1 (i.e. autoparity/position 10 just finished and you're
wrapping the roster back around), run the gate below first. **Positions
2 through 10 never trigger this gate at all** — they proceed straight to
their own step 1 (Spawn) unconditionally. This means one full lap (all 10
teams, one activation each) always completes end-to-end before the fixer
ever gets a turn; the fixer then runs (however many of its own internal
batches it needs, until clear or halted) exactly once, and only then does
the next lap's autoqa activation begin.

(This replaced an earlier design where the gate ran before every single
activation, all 10 positions — deliberately changed to once-per-lap so a
team's turn is never delayed waiting on the fixer, and issues get batched
into one fixer pass per lap instead of interrupting the round-robin
mid-lap.)

When the gate point above IS reached, check for eligible open issues:

```
gh issue list -R exampleorg/example-web-repo --state open --json number,labels --limit 200
gh issue list -R exampleorg/exampleapp-ios --state open --json number,labels --limit 200
```

Count issues (across both) carrying at least one of the 10 rotation labels
(`autoqa`, `autosecurity`, `autoaccessibility`, `autodesign`, `autoperf`,
`autolocalization`, `autoresilience`, `autoanalytics`,
`autointeroperability`, `autoparity`) that do NOT also carry
`autofix-needs-review` (the park label — those are excluded until a human
clears that label, regardless of rotation). **`clear` is only required for
`autosecurity` issues** — a non-security autoX label is sufficient on its
own; `autosecurity` issues additionally need the manually-applied `clear`
label before the fixer will even triage them (a vulnerability fix needs a
human's sign-off before code gets written, not just before merge — merge
itself is already gated separately, see the autoissuefixer skill's Merge
policy). Do NOT count `autosecurity` issues that lack `clear` toward the
trigger threshold below — an open backlog of un-cleared security issues is
expected and should NOT spawn the fixer session on its own. **No threshold
beyond that — even one eligible issue triggers a run.**

- **Zero eligible issues:** proceed straight to step 1 (Spawn) for autoqa
  as normal.
- **One or more:** do NOT spawn autoqa yet. Instead, treat this exactly like
  activating a team — spawn a session, brief it, wait for its DONE, tear it
  down — via the SAME `spawn-*.sh` / `director-log.md` DONE / `teardown-*.sh`
  shape as the activation protocol below, just with the fixer's own
  single-session scripts instead of a team's three-session ones. **This is
  the whole point of giving the fixer its own session: your job stays
  "spawn, brief, wait, teardown" every time, for every kind of work you
  hand off — you never absorb the Workflow tool's own triage/fix/review
  complexity (schemas, batch state, model tiers) into your own context. That
  complexity lives entirely inside the `auto-issue-fixer` session, which is
  free to spend as much context on it as it needs and then gets torn down.**
  1. Mint a run id (`date +%Y%m%d-%H%M%S`).
  2. Run `~/.claude/skills/director/scripts/spawn-issue-fixer.sh`. Wait
     ~15-20s, capture-pane to confirm the fresh Claude process is ready
     (same discipline as spawning a team — don't brief a TUI that isn't up).
     Update `DIRECTOR-STATE.md`'s pointer to `state=issue-fixer-running`.
  3. Nudge the `auto-issue-fixer` session with its full one-shot brief (it's
     blank, exactly like a freshly-spawned team session): "Read
     `~/.claude/skills/autoissuefixer/SKILL.md` in full, then run its
     pipeline for run id `{runId}` — `mkdir -p
     ~/Documents/auto-issue-fixer-docs/{runId}/` (this is your `docsDir`),
     then launch its Workflow per that skill's 'How to run this' section.
     Do NOT poll or sleep waiting for it — the Workflow call is a direct
     child of THIS session, so you'll get a `<task-notification>`
     automatically; just let your turn end after launching it. When that
     notification arrives, read the return value, append `DONE-<n>
     autoissuefixer haltedForUser=<bool> merged=<n> pending=<n> parked=<n>
     reason=\"<haltReason or ->\" <timestamp>` to
     `~/Documents/autoteam-registry/director-log.md`, then nudge the
     `director` tmux session. Your session will be killed by the Director
     shortly after — report DONE and stop, same as every team."
     Append `ACTIVATE-<n> autoissuefixer <timestamp>` to director-log.md
     first, same numbering sequence the teams use (one shared counter).
  4. **Wait / poll for DONE** — same short `/loop` cadence (~5-10 min) as
     waiting on a team, grepping director-log.md for the matching `DONE-<n>`
     line. No special-cased long fallback here; this is now file-based
     polling exactly like every other activation, precisely because the
     fixer session (not the Director) is the one directly holding the
     Workflow call.
  5. **Sanity-check the DONE** — `tmux capture-pane` the `auto-issue-fixer`
     session (idle/quiescent), plus the same machine-wide stray-process and
     booted-simulator checks used for team DONEs (step 5 of the activation
     protocol below applies here too — reuse it, don't write a second
     version).
  6. **Teardown.** Run
     `~/.claude/skills/director/scripts/teardown-issue-fixer.sh`.
  7. **Record.** Append the run to `DIRECTOR-STATE.md`'s activation history
     (same table, `team=autoissuefixer`) and update its row in
     `~/Documents/autoteam-registry/REGISTRY.md` (status/cycle/last-updated
     — the one other sanctioned own-row write, same as a team's idle-status
     write). Post a journal comment to the Director's own GitHub
     Discussions thread with the outcome counts.
  8. **Branch on `haltedForUser`** (parsed from the DONE line):
     - `false` → proceed to step 1 (Spawn) for autoqa (position 1) —
       the gate only ever fires right before autoqa's turn, so that's
       always the team waiting on the other side of it.
     - `true` → **full stop.** Do not spawn any team. Set `CURRENT:
       state=paused-for-user` in `DIRECTOR-STATE.md` with the `reason`
       field verbatim. Post a clear journal comment to the Director's own
       GitHub Discussions thread explaining what happened and that the
       round-robin is paused pending the user's review. **Call `ScheduleWakeup({stop: true})` — end your own `/loop`
       entirely.** Two consecutive parked issues most likely means
       something systemic (a broken login path, a dead test environment)
       that would keep failing every subsequent issue AND every subsequent
       team's checks the same way — continuing to spin is wasted work, and
       the user explicitly asked for a hard stop here, not a long
       sleep-and-retry. The user re-invokes `/director` manually once
       they've resolved it (resumes cleanly from `DIRECTOR-STATE.md`'s
       recorded position, per the Director state section above).

## The activation protocol (one full turn of one team)

1. **Spawn.** (For autoqa specifically: only reached once the Issue-Fixer
   Gate above found zero eligible issues, or was skipped as round 1's
   first-ever activation — see that section. For positions 2-10: the gate
   never applies to them at all, they always proceed straight here.) Run
   `spawn-team.sh <team>`. Wait ~15-20s for the three fresh
   Claude processes to reach a ready prompt (capture-pane each to confirm —
   don't brief a TUI that isn't up yet). All three sessions are BLANK: no
   memory of their skill, role, or folder. All continuity for the rotation
   (ledger, filed-issues, plan history) lives in its shared folder, which is
   exactly why blank sessions work.
2. **Brief.**
   - Send the Lead its rotation's slash command (e.g. `/autoqa`) via the
     nudge pattern so it loads its skill. Verify it submitted (capture-pane;
     clear the input with `C-u` first if a draft is sitting there).
   - Nudge EACH Principal with its FULL one-shot role brief per that
     rotation's SKILL.md "Session bootstrap" section: its role + exact tmux
     session name + cwd; "read `~/.claude/skills/<team>/SKILL.md` in full,
     then `~/.claude/skills/cross-platform-testing/SKILL.md` in full"; that
     rotation's write policy verbatim; the shared folder path; "wait for a
     `C1-START` directive before acting." A short "read lead-log.md" nudge
     to a blank session is a NO-OP — the full brief is mandatory.
3. **Activate.** Append `ACTIVATE-<n> <team> <timestamp>` to
   director-log.md, update DIRECTOR-STATE.md's pointer, then nudge the Lead
   (concrete session name, via nudge.sh) with the activation directive:
   > You are ACTIVATED by the Director (directive ACTIVATE-<n> in
   > ~/Documents/autoteam-registry/director-log.md — ACK it there first,
   > before acting). Your two Principal sessions (<web>, <ios>) were just
   > spawned fresh and have been sent their full role briefs — capture-pane
   > them to verify; re-brief per your skill's Session bootstrap section if
   > either looks blank. Run exactly TWO consecutive cycles per your skill's
   > normal Cycle structure, back to back — do NOT call ScheduleWakeup or
   > self-schedule; you do not self-pace. After cycle 2 closes, run your
   > skill's Deactivation/cleanup protocol (including the per-activation
   > GitHub Discussions journal comment(s)), append
   > `DONE-<n> <team> cycles=2 cleanup=confirmed <timestamp>` to
   > director-log.md, and nudge the `director` tmux session. Your session
   > will be killed by the Director shortly after — report DONE and stop.
   Capture-pane after the nudge to confirm it landed and the Lead is
   working. If no ACK appears in director-log.md within ~2-3 minutes,
   re-nudge and capture-pane to check the Lead is alive.
4. **Wait / poll for DONE.** Schedule your own wakeup at a short interval
   (~5-10 min) via your `/loop`. On each wakeup, grep director-log.md for
   `DONE-<n>`. If not there yet: capture-pane the team's three sessions for
   a brief status note in DIRECTOR-STATE.md's pointer line, then reschedule
   another short poll. Target activation length is **about an hour** — that
   is a target, NOT a deadline; do not kill on a clock. **Never activate or
   spawn anyone new until DONE-<n> is present AND sanity-checked.**
   **Stuck-Lead-while-Principals-idle check (do this on every poll, cheap
   and fast — don't wait for the 90-minute safety timeout to catch it):**
   also `tail` the team's shared folder `heartbeat.md`. If both Principals'
   most recent entries say something like "idle, standing by for Lead's
   close/deactivation directive" AND the Lead's own pane text is unchanged
   since your previous poll, that is a stuck Lead, not a slow one — this
   has happened for real (a Lead blocked on an untimed file-watcher for a
   check that had already finished, while both Principals sat idle for 35+
   minutes with nothing telling the Lead to look). Don't wait out further
   polls hoping it resolves itself: send ONE pointed nudge immediately —
   "heartbeat.md shows both Principals idle standing by for your close/
   deactivation directive since <time> — check heartbeat.md/lead-log.md now
   and proceed" — then grace-poll on your normal short cadence. This is a
   distinct, faster-triggering check from the 90-minute forced-teardown
   timeout below; use it every time, not just when something feels off.
5. **Sanity-check the DONE — never trust it blindly.**
   - `tmux capture-pane` all three of the team's sessions: idle/quiescent,
     no spinner, no half-typed prompt, no active work.
   - `xcrun simctl list devices | grep Booted` — no simulator left booted.
   - `pgrep -fl 'watch.sh|monitor-peers.sh|xcodebuild|nudge.sh|heartbeat'` —
     no stray background jobs (the shared dev server, `npm start` on
     :4200, is NOT a violation; it stays up for everyone). **This must be
     a machine-wide check, not scoped to the current team** — a Lead's
     heartbeat loop or watcher is sometimes started detached
     (nohup/disown-style), which `tmux kill-session` does NOT reap, so it
     can survive a PRIOR team's teardown indefinitely and keep firing
     nudges at old session names for hours. This happened for real: three
     orphaned heartbeat loops from earlier activations that round were
     still running when a later team spawned, and one of them fired a
     stray nudge straight into the fresh team's just-spawned Principal
     before it had even been briefed. If you find a stray match, `kill`
     it immediately (note the PID and originating team in your notes) —
     don't wait for the next team's spawn to surface it.
   If the DONE says `cleanup=incomplete`, or the sanity check contradicts
   `cleanup=confirmed`, nudge the Lead once to finish cleanup and re-check;
   record what happened in the notes column either way.
6. **Teardown.** Run `teardown-team.sh <team>` — kills exactly this team's
   three sessions, AND (as a safety net) any orphaned background process
   whose command line matches one of this team's session names — see the
   comment in the script for why this is needed. Never touch the user's
   general panes, `director` itself, or any other team's names (there
   should never BE another team alive, but
   the script is scoped by name regardless). Confirm with `tmux ls` that
   the session count dropped back to baseline (general panes + director).
7. **Record and advance.** Append the activation row to DIRECTOR-STATE.md,
   update the team's row in `~/Documents/autoteam-registry/REGISTRY.md` to
   `status=idle` (the ONE sanctioned exception to the registry's
   own-row-only rule), post the journal comment (below), pause
   briefly (a few minutes is fine — a deliberate breather), then start the
   NEXT team in roster order back at step 1 with `ACTIVATE-<n+1>`. Same
   turn — do not schedule a long sleep between teams.

## Safety timeout (~90 minutes)

Two cycles at 3-6 checks/side comfortably fit inside an hour; don't
hard-fail early. But if `DONE-<n>` hasn't appeared ~90 minutes after
activation, treat the team as stuck:
- capture-pane all three of the team's sessions to diagnose: degenerate
  repeated-single-word output, a fully-typed-but-unsubmitted prompt, a dead
  Claude process, or genuinely-still-working on something long;
- a merely-idle Lead or unsubmitted prompt → one pointed nudge ("status?
  finish and report DONE-<n>") and a short grace poll;
- if that doesn't produce DONE (or the session is genuinely
  stuck/poisoned/dead): **force the teardown anyway** — run
  `teardown-team.sh <team>`, then do the machine-level cleanup the team
  skipped (shut down any booted simulator via
  `xcrun simctl list devices | grep Booted` → `xcrun simctl shutdown <udid>`;
  kill stray watch/monitor/xcodebuild jobs);
- log the anomaly clearly in DIRECTOR-STATE.md (`forced=yes`,
  `cleanup-confirmed=no` if applicable, full diagnosis in notes) and in a
  GitHub Discussions journal comment. Never silently pretend a forced
  teardown was clean, and never leave a stuck team's sessions alive while
  spawning the next.

## The Director's /loop (the ONLY self-scheduler in the system)

Run the Director under `/loop` with NO interval (self-paced). The ten
rotation Leads never self-schedule — this session is the only one that
calls ScheduleWakeup.

- **While a team is active / awaiting DONE:** short cadence, ~300-600s per
  wakeup. Each wakeup = check for DONE, sanity-check or status-note, **run
  the health sweep below**, reschedule.
- **The moment DONE + cleanup is confirmed:** same turn — teardown, record,
  brief pause, spawn + brief + activate the next team, then back to
  short-cadence polling for the new team.
- **On a fresh start** (`/director` just invoked): read DIRECTOR-STATE.md
  (create it and director-log.md if missing), reconcile against `tmux ls`
  (see Director state section), resume from the recorded position — or, if
  there is no history, start the round-robin at position 1 (autoqa). Run
  the health sweep once before anything else, too — a fresh start is
  exactly when a prior run's drift is most likely to be sitting there
  unnoticed.

## Health sweep (run on every poll, not just at DONE)

The DONE sanity-check (step 5 of the activation protocol) already looks
for stray processes and booted simulators, but only right when a team
closes out. Drift can appear at any point, not just then — so this same
cheap check runs on **every** `/loop` wakeup, whether or not a team is
mid-activation. Auto-remediate, don't just report: this system already
treats cleanup as self-healing everywhere else (teardown-team.sh, the
DONE sanity-check's stray-process kill), so the health sweep follows the
same philosophy rather than introducing a second standard.

1. **Session count.** `tmux ls` — expected baseline is the user's general
   panes + `director` + `dashboard`, plus AT MOST one active team's trio OR
   the `auto-issue-fixer` session (never both). If the count is elevated
   beyond that, identify which extra session(s) and why before doing
   anything — don't guess-kill something the user might be using by hand.
   Only act on sessions that are structurally recognizable as this system's
   own artifacts (an exact match on a known Lead/Principal/`auto-issue-fixer`
   name from a team that should NOT currently be active per
   DIRECTOR-STATE.md's pointer) — anything else gets logged, never touched.
2. **Orphaned background processes**, machine-wide (not scoped to one
   team): `pgrep -fl 'watch.sh|monitor-peers.sh|heartbeat|xcodebuild|nudge.sh'`.
   Cross-reference each hit against DIRECTOR-STATE.md's current pointer — if
   it doesn't belong to the currently-active team (or belongs to no team at
   all because nothing is active), it's an orphan from an incomplete prior
   teardown. `kill` it. This is the exact same failure mode described in
   the Safety timeout / DONE sanity-check sections (a detached nohup
   process survives `tmux kill-session`) — the health sweep is just casting
   that same net continuously instead of only at teardown moments.
3. **Booted iOS simulators.** `xcrun simctl list devices | grep Booted` — if
   one is booted and no team is currently active (or the active team is web
   Sonnet-only work with no iOS leg running), `xcrun simctl shutdown <udid>`
   it.
4. **Logging.** Only write something when the sweep actually finds and
   fixes an anomaly — a clean sweep needs no log entry, don't spam
   DIRECTOR-STATE.md or the Discussions thread on every poll. When it does
   find something: one line in DIRECTOR-STATE.md's notes (what, when,
   what action taken) and one comment on the Director's Discussions
   thread, phrased plainly enough a human skimming it understands what
   happened without needing this file open.

## Progress journal in GitHub Discussions

Apple Notes is retired (2026-07) — journaling now goes to the Director's
own persistent GitHub Discussions thread in `example-web-repo` (the cross-cutting
default repo, same convention autoqa already uses for cross-platform issue
ownership). Write **one comment per completed activation-turn** (at step 7:
"<team> round <r>: spawned <t1>, DONE <t2>, 2 cycles,
cleanup confirmed/incomplete, next up <team>"), plus a comment on any
timeout/force-teardown/escalation and on every Issue-Fixer Gate run (merged/
pending/parked counts, `haltedForUser` if applicable) — so the human can
follow the round-robin without watching panes. Do NOT journal on every poll
wakeup. Thread ID and the full posting recipe live in
`~/Documents/autoteam-registry/DISCUSSIONS.md` (the `director` row) — in
short:

```bash
gh api graphql -f query='
mutation($id: ID!, $body: String!) {
  addDiscussionComment(input: {discussionId: $id, body: $body}) {
    comment { id url }
  }
}' -f id="<director's discussion node id from DISCUSSIONS.md>" -f body="<your journal entry text>"
```

**Token efficiency: delegate each journal write to a `haiku`-model
subagent** (Agent tool, `model: "haiku"`), pasting this recipe verbatim
plus the facts to record and the correct discussion id, so it executes
without exploring.

## What the Director never does

- Never runs a check, opens the app, boots a simulator, or files an issue
  itself — the Issue-Fixer Gate is the one exception where it launches work
  that DOES those things, but it does so by handing off to the
  `autoissuefixer` Workflow, never by doing them in its own session.
- Never writes to a team's shared folder (LEDGER/PLAN/lead-log/acks) — its
  own shared files are director-log.md, DIRECTOR-STATE.md, the single
  status=idle registry write in step 7, and minting
  `~/Documents/auto-issue-fixer-docs/{runId}/` for the Issue-Fixer Gate.
- Never merges code, opens a PR, or decides a fix passed — that judgment
  belongs entirely to the `autoissuefixer` Workflow's own Fable agents,
  which actually watch the interactive test run. The Director only reads
  the Workflow's final `haltedForUser` flag and counts.
- Never has two teams' sessions alive at once, and never spawns the next
  team before the current one's DONE is confirmed (or force-teardown
  completed) AND its sessions are gone.
- Never kills the user's general-purpose panes (`skills`, `documents`/
  `documents-N`, `mini`/`mini-N`, numbered panes, `boot`, `even-N`,
  `exampleapp-marketing`) or its own `director` session — teardown-team.sh is
  scoped so this cannot happen; keep it that way.
- Never kills the shared dev server (`npm start` on :4200) — it survives
  across activations; teams clean up only what they personally opened.
