---
name: autoqa
description: Perpetual (24/7) automated QA rotation for the ExampleApp apps. A Lead session plans QA cycles and orchestrates two Principal engineer tmux sessions (exampleapp = web, exampleapp-ios = iOS simulator) through rotating checks across both roles (owner/hero). Findings are NEVER fixed and NOTHING is ever committed — every confirmed finding becomes a GitHub issue in the owning platform's repo. A coverage ledger guarantees each cycle checks something different from the last. Runs as one arm of the Director's serialized round-robin (see the director skill): the Director spawns this team's three sessions fresh for each activation (exactly two back-to-back cycles), then tears them all down — sessions never persist between activations and never self-pace or self-schedule. Use when the user says "autoqa", "start the QA loop", "run continuous QA", or references this skill.
version: 1.0.0
---

# AutoQA — perpetual cross-platform QA rotation

Same three-session topology and delivery machinery as the
`cross-platform-testing` skill (READ IT — its watcher/nudge/ACK scripts,
tmux discipline, compaction protocol, heartbeat, backend-verify methods,
and platform gotcha lists all apply verbatim; scripts live at
`~/.claude/skills/cross-platform-testing/scripts/`). What changes is the
MISSION:

- **No fixes. No commits. Ever.** A finding's only output is a GitHub issue.
- **Runs forever**, but paced by the Director (see the Director
  activation section): each `ACTIVATE-<n>` = exactly two back-to-back
  cycles, after which the Director tears the team's sessions down until the next activation.
- **Never checks the same thing twice in a row** — a coverage ledger picks
  the stalest areas each cycle.

## Session bootstrap (Director-managed, ephemeral sessions)

Three tmux sessions, each a separate persona:

| Role | tmux session | cwd |
| --- | --- | --- |
| Lead Staff Engineer | `lead-engineer` (or similar `lead*`) | `~/Documents/lead-engineer` |
| Principal Staff Engineer — Web | `exampleapp` | `~/Documents/exampleapp` |
| Principal Staff Engineer — iOS | `exampleapp-ios` | `~/Documents/exampleapp-ios` |

**These three sessions are spawned and torn down by the Director** — see
`~/.claude/skills/director/SKILL.md` and its `scripts/spawn-team.sh` /
`scripts/teardown-team.sh`. They are created fresh immediately before each
activation and killed immediately after the DONE report; you should never
need to create or kill your own tmux session. Nothing persists in session
memory between activations — ALL continuity (ledger, filed-issues, plan
history) lives in the shared folder (`~/Documents/exampleapp-autoqa/`), never
in a standing session. Sessions launch with
`claude --dangerously-skip-permissions` — **no `--continue`** — and are
briefed from the shared folder, not from prior transcript history.

**The FULL one-shot role brief (sent by the Director at spawn; verified —
and re-sent if needed — by the Lead).** The Director nudges each
freshly-spawned Principal with this brief before activating the Lead.
Lead: BEFORE writing `PLAN-1.md`, capture-pane both Principals to confirm
the brief landed — if either looks blank/unbriefed, send it the FULL brief
yourself via `nudge.sh`.
A freshly-launched Principal session starts completely blank: no memory of
this skill, its role, the write policy, or the shared folder. A short "read
lead-log.md and ACK" nudge to a blank session is a NO-OP — it has no context
to act on. So the first message EACH
Principal receives must be a complete brief containing:
- its role (Web / iOS Principal), exact tmux session name, and cwd;
- "read this SKILL.md (`~/.claude/skills/autoqa/SKILL.md`) in full, then read
  `~/.claude/skills/cross-platform-testing/SKILL.md` in full";
- the write policy that applies here (**dev writes PERMITTED on exampleapp-dev
  only; tag test data `AUTOQA-<cycle>`; pace writes; prefer real-UI cleanup**);
- the shared folder path (`~/Documents/exampleapp-autoqa/`);
- "wait for a `C1-START` directive before acting."
ONLY after that full brief has landed and been ACKed do the short "read
lead-log.md and ACK"-style nudges become meaningful for later directives.
Skipping the full brief (it's easy to skip) leaves the Principals inert.

If a Principal dies or looks stuck MID-activation, `tmux capture-pane` it
first to confirm before relaunching — mid-activation recovery (see the
hygiene section) is the ONE case where the Lead relaunches a session
itself.

## Environment facts
- Web Principal: tmux `exampleapp`, repo `~/Documents/exampleapp`, app on
  `http://localhost:4200` (hero) / `http://[::1]:4200` (owner).
- iOS Principal: tmux `exampleapp-ios`, simulator + XCUITest.
- Backend: Firebase **exampleapp-dev** — DEV ONLY, nothing ever touches prod,
  so writes (including destructive flows) are permitted. Still: tag test
  data with an `AUTOQA-<cycle>` marker in notes/descriptions, pace writes
  (throughput ramp), and prefer cleanup of clutter you created via the real
  UI when cheap. Test accounts: `test.owner@exampleapp.test` /
  `test.hero@exampleapp.test`, pw `ExamplePass123!` (Dev Quick Login on web /login).
- GitHub (via `gh`, account exampleorg): web issues →
  `exampleorg/example-web-repo`; iOS issues → `exampleorg/exampleapp-ios`;
  cross-platform issues → the repo that OWNS the fix (data-contract/rules
  issues → example-web-repo, which owns firestore.rules).

## Shared resource awareness (cross-rotation coordination)
Eight autoX rotations share this machine's infra (serialized by the
Director — only one team's sessions ever exist at a time). EVERY rotation's Web
Principal shares the SAME `~/Documents/exampleapp` dev server and EVERY iOS
Principal shares the SAME `~/Documents/exampleapp-ios` simulator. A best-effort
shared registry lives at `~/Documents/autoteam-registry/REGISTRY.md`.
- It is coordination, **not a hard lock.**
- **A Lead only ever writes its OWN row, never another rotation's.**
- **Check it before restarting the shared dev server or simulator** — if a
  sibling rotation shows `status=executing`, hold off or coordinate rather
  than restarting shared infra out from under its Principal mid-check.
Update your own row (status + cycle + last-updated) at each phase transition.
**Director-era note:** the Director now serializes all eight rotations —
only one team's Principals ever touch the shared dev server / simulator at
a time — so cross-rotation contention is far less likely than under the old
concurrent model. The registry discipline (own-row-only writes, check
before restarting shared infra) still applies unchanged.

## Shared folder layout
`~/Documents/exampleapp-autoqa/` (create on first run):
- `LEDGER.md` — the coverage ledger (below). Source of truth for rotation.
- `PLAN-<cycle>.md` — the Lead's per-cycle plan (small: 3-6 checks/side).
- `cycle-<n>/web.md`, `cycle-<n>/ios.md` — Principal logs, append-only,
  same STEP/COORD/ACK format as cross-platform-testing.
- `acks.md`, `lead-log.md`, `heartbeat.md` — same protocol as the parent
  skill. NOTE the await-acks substring caveat from the parent skill
  (`exampleapp` vs `exampleapp-ios`) — confirm acks with exact-match grep.
- `filed-issues.md` — one line per issue ever filed:
  `<repo>#<num> | <fingerprint> | <title> | <cycle>` — the dedup index.
  **LEAD-OWNED FILE — Principals never write to it directly.** A Principal
  that files an issue reports the number+fingerprint+title in its OWN
  cycle log only; the Lead is the sole writer of filed-issues.md, adding
  the line once at cycle close (this is what the mandatory reconciliation
  step does). Two writers appending independently is what caused duplicate
  lines in practice — if a Principal ever does append directly anyway,
  the Lead's reconciliation pass will catch and dedupe it, but the rule is
  Principals report, Lead records.

## The coverage ledger
`LEDGER.md` is a table of focus areas × platform × role with last-checked
cycle/timestamp and last result:

```
| area | platform | role | last-cycle | last-checked | last-result |
| bookings-lifecycle | web | owner | 3 | 2026-07-21T14:00 | clean |
| bookings-lifecycle | ios | hero  | 2 | ... | issue example-web-repo#12 |
```

Seed it from the app's real surface map (the RUN 3 census in
`~/Documents/exampleapp-crossplatform-test/FINDINGS.md` is the authoritative
surface list). Suggested areas: bookings-lifecycle, cancel/decline,
messaging, vehicles-garage, shared-vehicles, invoices-payments, earnings,
customers-crm, profile-settings, privacy-sharing, notifications,
diagnostics-nhtsa, service-history, analytics, marketing-promotions,
disputes, auth-flows, error-routes/empty-states, console-errors-sweep,
rules-probes (REST permission checks), data-shape-audit (REST doc shape
diffs), perf-smoke (load times). Add new rows whenever the app grows.

**Each cycle the Lead picks the 3-6 STALEST rows per platform** (oldest
last-checked), biased toward: rows that last produced an issue (re-verify
it's filed, look adjacent), and areas touched by recent commits
(`git log --oneline -10` in each repo). Update the ledger at cycle close.

## Cycle structure (one cycle; a Director activation = two of these, back to back)
1. **Plan** (Lead): read LEDGER.md + filed-issues.md + recent git log;
   write `PLAN-<cycle>.md` — for each chosen area, 1-3 CONCRETE checks
   with role assignment and what "pass" means. Vary the angle vs the
   area's previous visit (different role, different edge, different data
   state) — the ledger's last-result cell tells you what was done before.
2. **Distribute**: directive `C<cycle>-START` in lead-log.md → nudge both
   → await acks (exact-match confirm).
3. **Execute** (Principals): run checks, backend-verify (client-auth REST),
   log honestly (DONE/MISS/BLOCKED-tooling; the parent skill's known
   XCUITest/CDP limits are cited, not ground on). Cross-role legs
   coordinate peer-to-peer exactly as in cross-platform-testing.
   **Log incrementally, not at the end.** Append an entry to your cycle
   log immediately after EACH check completes (or after any single
   significant sub-step on a long investigation) — never batch a whole
   cycle's findings into one write at the very end. A Principal that goes
   10+ minutes of active work with zero log entries is a repeated failure
   mode observed in practice; the Lead will nudge on it, but don't wait
   to be nudged.
4. **File issues** (Principal who found it, Lead arbitrates ownership):
   see protocol below. FINDINGS ARE NOT FIXED — no code edits, no commits.
5. **Close** (Lead): update LEDGER.md rows + filed-issues.md, write a
   2-4 line cycle verdict in lead-log.md, direct Principals to stand by
   (sessions stay up between the two cycles of one activation), and do NOT schedule any
   wakeup (Director model — see the Director activation section).
   **MANDATORY reconciliation, every cycle close, no exceptions:** run
   `gh issue list -R <repo> --label autoqa --state all --json number` for
   BOTH repos and diff the counts/numbers against filed-issues.md's
   `<repo>#<n>` entries. Add any issue present on GitHub but missing from
   the index (a Principal filed it but the Lead never recorded it), and
   remove exact-duplicate lines (same repo#num appearing twice). This
   caught real drift once already (two issues had fallen out of the index
   entirely, one was duplicated) — never skip it, even under time pressure
   or a fast no-gap cadence.

## GitHub issue protocol
Before filing, DEDUP: compute a fingerprint (`<area>/<platform>/<short
slug of root cause>`), check `filed-issues.md`, then
`gh issue list -R <repo> --search "<keywords>" --state all` — if an open
issue covers it, comment with the new evidence instead of filing; if a
closed one covers it, file a new issue linking the old (regression).

File with:
```
gh issue create -R <repo> \
  -t "[autoqa] <concise defect title>" \
  -b "<body>" -l autoqa
```
(Create the `autoqa` label once per repo if missing: `gh label create
autoqa -R <repo> -c '#d93f0b' -d 'Filed by the AutoQA loop' || true`.)
Body must contain: **What/Expected/Actual**, **Repro steps** (numbered,
from a real account), **Evidence** (REST doc paths + values, file:line
code citations, screenshot filenames from the cycle folder), **Severity**
(high/medium/low), **Cycle** number, and **Env** (exampleapp-dev, build/
branch SHA from git log). Known pre-existing issues already tracked in
`~/Documents/exampleapp-crossplatform-test/*-issues.md` should be filed
ONCE (a backfill cycle is a good first cycle), then treated as known.

## Progress journal in GitHub Discussions

**Exactly ONE comprehensive comment per activation**, posted by the Lead
during the Deactivation/cleanup protocol, right before reporting DONE — do
NOT journal mid-cycle. This system used to journal to Apple Notes; that's
retired (2026-07) in favor of persistent, searchable GitHub Discussions
threads. The comment summarizes the WHOLE activation: both cycles' checks
run, findings/issues filed (numbers + titles), ledger areas covered, and
any blockers or anomalies.

This rotation covers BOTH platforms every activation, so post it as **two
comments** — the web-relevant portion to this rotation's `web` thread, the
iOS-relevant portion to its `ios` thread. Thread IDs, the full posting
recipe, and the design rationale all live in
`~/Documents/autoteam-registry/DISCUSSIONS.md` — read it for the exact
`discussionId` values (do not hardcode them here; that file is the single
source of truth so a thread change never requires editing this doc). In
short:

```bash
gh api graphql -f query='
mutation($id: ID!, $body: String!) {
  addDiscussionComment(input: {discussionId: $id, body: $body}) {
    comment { id url }
  }
}' -f id="<autoqa's web or ios discussion node id from DISCUSSIONS.md>" -f body="<your journal entry text>"
```

**Token efficiency: delegate each journal write to a `haiku`-model
subagent** (Agent tool, `model: "haiku"`), pasting this recipe verbatim
plus the facts to record and the correct discussion id, so it executes
without exploring.

## Director activation (replaces the old /loop self-pacing)

This Lead does **NOT** run under `/loop` and does **NOT** call ScheduleWakeup
— ever. Scheduling for all eight autoX rotations is centralized in the
Director session (tmux `director`, skill
`~/.claude/skills/director/SKILL.md`), which serializes them into a strict
round-robin: only ONE rotation is ever actively executing at a time. This
rotation's roster position is **1 of 8** (the full roster order lives in
the Director skill and in the `roundrobin-position` column of
`~/Documents/autoteam-registry/REGISTRY.md`). The old hourly stagger-offset
table is retired.

There is no idle steady state anymore — this team's three sessions exist
ONLY during an activation. The Director spawns them fresh (via its
`spawn-team.sh`), briefs both Principals, appends an `ACTIVATE-<n>` line to
`~/Documents/autoteam-registry/director-log.md`, and nudges this Lead with
the activation directive; after the DONE report it kills all three
sessions. A freshly-spawned Lead should expect that activation directive as
its first real instruction.

On receiving an `ACTIVATE-<n>` directive:
1. **ACK immediately, BEFORE acting**: append
   `ACK ACTIVATE-<n> lead-engineer <HH:MM>` to director-log.md via
   `~/.claude/skills/cross-platform-testing/scripts/ack.sh` pointed at that
   file (on this machine the concrete pane is often `lead-9` in tmux group `lead` — ACK with the concrete name) — same ACK-first discipline as every other directive in
   this system.
2. Check both Principals (`tmux capture-pane`). All three sessions were
   just spawned fresh by the Director, which also sends each Principal its
   full role brief — verify the briefs actually landed; if either Principal
   looks blank/unbriefed, send it the FULL one-shot role brief per the
   Session bootstrap section above before anything else.
3. Run **EXACTLY TWO consecutive cycles**, back to back with no idle gap
   between them, each following the Cycle structure above in full (plan →
   distribute → execute → file issues → close, twice — including both
   ledger updates and both mandatory reconciliation passes). Never a third
   cycle; never a ScheduleWakeup.
4. After cycle 2 closes, run the **Deactivation / cleanup protocol**
   (below) with both Principals.
5. Append `DONE-<n> autoqa cycles=2 cleanup=confirmed <timestamp>` to
   director-log.md (use `cleanup=incomplete` plus what's still open if
   that's the truth), set your own registry row to `idle`, and nudge the
   `director` tmux session directly so it doesn't have to wait for its
   next poll.
6. Done — your job for this activation is over. The Director will kill
   all three of this team's sessions shortly; do not wait around, poll,
   or schedule anything.

## Deactivation / cleanup protocol (after cycle 2, before reporting DONE)

Non-negotiable: the Director kills this team's three sessions right after
the DONE report, and NOTHING may be left running behind them — no booted simulators, no lingering browser tabs/tab groups, no zombie
background watch/monitor processes. Before the Lead reports DONE to the
Director:

- **iOS Principal**: shut down the specific simulator device used this
  activation — `xcrun simctl list devices | grep Booted` to find it, then
  `xcrun simctl shutdown <udid>` for that device. Do NOT blanket
  `shutdown all` (something unrelated to this rotation might be booted —
  target the specific device). Kill any lingering `xcodebuild test`
  processes it started.
- **Web Principal**: close every browser tab / tab group it opened this
  activation — track what you open as you go so you can close exactly
  that, not the user's unrelated tabs (use whichever browser tool you were
  actually driving: `mcp__claude-in-chrome__tabs_close_mcp` or the
  Playwright `browser_tabs` close action). Do NOT kill the shared dev
  server itself — other rotations need it running — only the browser
  surface you personally opened.
- **Both Principals**: kill any background shell jobs you started
  (`watch.sh` / `monitor-peers.sh` instances, pollers). Nothing may still
  be running or polling once the team goes idle.
- **Lead**: direct both Principals to run their cleanup and confirm it
  back — a short ACK-style exchange in the shared folder is enough, don't
  over-engineer it. Kill your OWN background jobs too (heartbeat loop,
  watchers). Only after BOTH Principals confirm do you write
  `cleanup=confirmed` in the DONE report. If cleanup can't be fully
  confirmed for some reason, report `cleanup=incomplete` honestly with
  what's still open — do not claim success to get the Director to move on
  faster.
- **Lead — the single activation journal entry (required before DONE):**
  after both Principals confirm cleanup, post exactly ONE in-depth
  journal comment per platform with activity per the Progress-journal
  section above (GitHub Discussions, same recipe, delegated to a
  `haiku`-model subagent) summarizing the WHOLE activation: both cycles' checks run, findings and
  issues filed (numbers + titles), ledger areas covered, and any blockers
  or anomalies. This one note replaces the old per-cycle journaling. THEN
  append the `DONE-<n> ...` line to director-log.md and nudge the
  `director` session — after that your work is finished; this session gets
  killed by the Director shortly, nothing more to do.

## Session hygiene during an activation
- Watch both Principal panes as you monitor for long-context hedging and
  apply the parent skill's compaction protocol (never interrupt mid-work;
  `C-u` then `/compact <resume brief>`; ALWAYS nudge after compaction).
  Expect to compact each Principal every few hours of activity.
- Watch for degenerate output (the repeated-single-word failure mode):
  diagnose via the session's transcript JSONL; a poisoned context needs
  /clear + a full re-brief from the shared folder (everything needed to
  rebuild is in LEDGER/PLAN/lead-log/cycle logs — write them accordingly).
- Restart the dev server / simulator per the parent skill's notes when
  flakiness accumulates. Keep the heartbeat loop running; read
  heartbeat.md as you monitor.
- Keep per-cycle plans SMALL (3-6 checks/side). Depth comes from the
  rotation over days, not from marathon cycles.
- If a Principal's Claude process dies MID-activation (crash, quota,
  manual kill), relaunch just that session (`tmux new-session -d -s <name>
  -c <dir>` per the Session bootstrap table, then
  `claude --dangerously-skip-permissions`, no `--continue`) and re-brief it
  with the FULL role brief before resuming its role in the current cycle.
  This mid-activation recovery is the ONE case where the Lead creates a
  session — steady-state spawn/teardown always belongs to the Director.
