---
name: canifidevsetup
description: >-
  Interactive setup wizard that interviews the user (AskUserQuestion-driven) about their own projects, platforms, goals, and constraints, then GENERATES a complete custom director+teams tmux orchestration system as real skill files under ~/.claude/skills/ — a parameterized round-robin director, one skill per team/rotation, shared nudge/ack/watch coordination scripts, spawn/teardown scripts, and a bootup script. Generalizes the battle-tested ExampleApp autoX system to any user's setup (web-only, backend-only, android/ios/web mixes, multiple repos, findings-only QA vs real feature development). Use when the user says "canifidevsetup", "/canifidevsetup", "set up my dev team", "set up my agent teams", "build me a director", or references this skill.
version: 1.0.0
---

# canifidevsetup — interview-driven generator for a custom director+teams system

You are running an interactive interview, then generating REAL skill files.
The output is not a design doc — it is a working set of `SKILL.md` files and
bash scripts under `~/.claude/skills/` that implement a director-orchestrated,
on-demand spawn/teardown tmux team system tailored to THIS user's projects.

**The mechanics authority is bundled inside this skill, at
`$PLUGIN_ROOT/skills/canifidevsetup/reference/`.** No external export or zip is
required — everything Phase 6 needs to mirror ships with this skill itself.
Before generating anything in Phase 6, read these bundled files in full —
every generated file mirrors their patterns with the user's answers
substituted in:

| Bundled reference file | What it's the authority on |
| --- | --- |
| `reference/director.SKILL.md` | Round-robin orchestration, DIRECTOR-STATE.md, director-log.md protocol, health sweep, safety timeout, on-demand lifecycle |
| `reference/director-scripts/spawn-team.sh`, `teardown-team.sh` | Exact bash idioms: group-aware `session_exists()`, `launch()`, idempotent `kill_matching()`, orphan `pgrep -f` safety net |
| `reference/director-scripts/spawn-issue-fixer.sh`, `teardown-issue-fixer.sh` | Single-session (no-Principals) spawn/teardown variant |
| `reference/bootup.SKILL.md`, `reference/bootup.sh` | Idempotent bootstrap, `is_fresh` tracking, `trigger_lead` retry-and-verify submit |
| `reference/cross-platform-testing.SKILL.md` | The shared coordination protocol all teams reuse (PLAN.md, lead-log.md, acks.md, heartbeat.md, watchers, delivery guarantee, no-fake-writes) |
| `scripts/` (nudge.sh, ack.sh, watch.sh, await-acks.sh, monitor-peers.sh) | Already-generic helpers, bundled in this skill's own `scripts/` dir — copied, not rewritten |
| `reference/autoqa.SKILL.md` | Concrete example of a findings-only rotation (coverage ledger, issue filing, dedup, reconciliation) |
| `reference/autoissuefixer.SKILL.md` | Concrete example of a single-session fixer (model tiers, circuit breaker, merge policy) |

**Non-negotiable properties carried forward from the source (never made
optional silently — the user can override lifecycle in Phase 4, but the
default and your recommendation is always this):**

- **On-demand spawn/teardown.** A team's sessions exist ONLY while that team
  is activated. The source redesign exists because 24 always-on sessions
  froze a real machine. Steady state = user's own panes + director + at most
  ONE team's sessions.
- **Group-aware tmux existence checks.** iTerm2's tmux integration creates
  numbered siblings inside a session *group* (`lead-9` in group `lead`);
  `tmux has-session` misses them and caused a real duplicate. Every
  existence check and every kill in every generated script must match on
  `#{session_name}` OR `#{session_group}`.
- **ACK-before-act.** Every directive gets ACKed in the shared file before
  the recipient starts acting.
- **No `nohup`/`disown` ever** for watchers/heartbeats. A detached process
  survives `tmux kill-session` and misfired into a freshly-spawned session
  with a reused name in a real incident. Background loops run as plain pane
  children (`run_in_background: true` or `&`), and teardown scripts carry
  the `pgrep -f <session-name>` orphan safety net anyway.
- **Read before you watch.** A watcher only detects CHANGE from baseline —
  it is structurally blind to a condition already true when it started.
  Always read/tail the target file first; always pass an explicit timeout.
- **Verify, don't trust.** DONE reports get sanity-checked (capture-pane,
  stray-process sweep); UI success gets backend-verified; forced teardowns
  get logged honestly, never papered over.

## Interview discipline

- Ask via `AskUserQuestion`. Open-ended questions use a free-text-friendly
  format (a question whose options are broad framings plus "Other" — the
  user's typed answer is the real payload). Closed questions offer concrete
  options.
- **Adapt the question tree.** Phases 2-4 below list what must be COVERED,
  not a fixed script. Let Phase 1's free-text answers reorder, reword, and
  prune: a user who says "I have one Django repo and want automated QA on
  it" should never be asked which of their five platforms the iOS team
  owns. Skip nothing on the coverage list, but ask it in the form their
  context makes natural, and batch related questions into single
  AskUserQuestion calls (up to 4 questions per call) where they're
  independent.
- **Never assume anything the source hardcoded.** Platforms, repo names,
  directory layout, roster size and order, team count, org shape, mission
  type, model tiers, journal target — all interview answers, never defaults
  copied from ExampleApp.
- Record answers as you go into a scratch summary you maintain in
  conversation (not a file) — Phase 5 replays it back for confirmation.
- If the user's answer is vague where a generated file needs a concrete
  string (a repo, a path, a session name), follow up until you have the
  literal value. Generated files contain real `org/repo` strings and real
  absolute paths, exactly as the source hardcodes `exampleorg/example-web-repo`
  and `~/Documents/exampleapp` — placeholders in output files are a failure.

---

## Phase 0 — Preflight

### Resolving this plugin's own files

`$CLAUDE_PLUGIN_ROOT` is **not** exported into the Bash tool, so never rely on it alone.
Resolve the plugin root with this block and use `$PLUGIN_ROOT` from then on:

```bash
CFG="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-}"
[ -n "$PLUGIN_ROOT" ] && [ -d "$PLUGIN_ROOT" ] || \
  PLUGIN_ROOT="$(ls -d "$CFG"/plugins/cache/canifi/canifi/*/ 2>/dev/null | sort -V | tail -1)"
[ -n "$PLUGIN_ROOT" ] && [ -d "$PLUGIN_ROOT" ] || \
  PLUGIN_ROOT="$CFG/plugins/marketplaces/canifi/plugins/canifi"
PLUGIN_ROOT="${PLUGIN_ROOT%/}"
echo "$PLUGIN_ROOT"
```

Order matters: the env var if it is ever populated, then the newest installed version
(`sort -V`, because `0.10.0` sorts below `0.9.0` lexically), then the marketplace clone as
a last resort. If the final `echo` prints nothing or the directory has no `skills/`
subdirectory, stop and tell the user the plugin looks broken — do not guess a path.



1. Confirm the bundled reference material exists:
   `ls $PLUGIN_ROOT/skills/canifidevsetup/reference/ $PLUGIN_ROOT/skills/canifidevsetup/scripts/`.
   If either is missing, tell the user plainly and stop — this skill's
   install is incomplete and generation has no authority to mirror without
   it. Do not fall back to searching for or requesting an external export —
   the reference material ships inside this skill; there is no other
   legitimate source.
2. Check for prior runs: does `~/.claude/skills/director/SKILL.md` (or any
   skill this wizard previously generated — look for a
   `generated-by: canifidevsetup` line in frontmatter) already exist? If
   yes, ask the user up front: update/regenerate the existing system, or
   abort. Never silently overwrite; if regenerating, back up each file to
   `<file>.bak.<epoch>` before writing.
3. Confirm `tmux` and `gh` are installed (`command -v tmux gh`). Missing
   `gh` only matters if the interview later lands on GitHub for issues or
   journaling — note it, don't block yet.

## Phase 1 — Open-ended discovery (always first, always free-form)

Ask these as genuinely open questions and read the answers carefully — they
shape which later questions exist at all:

1. **"What are you actually trying to achieve long-term with this setup?"**
   (continuous QA coverage? autonomous feature development? overnight
   automation while they sleep? something else entirely?)
2. **"Describe your ideal end state — six months from now, this system is
   working perfectly. What is it doing day to day, and what are you doing?"**
3. **"Tell me about the project(s) this will run against — what are they,
   what platforms/stacks, roughly what shape is the codebase in?"**

Summarize what you heard back to the user in 2-4 sentences and let them
correct you before narrowing. Everything in Phases 2-4 gets filtered
through these answers.

## Phase 2 — Mission and scope

Cover (adapting to Phase 1):

- **Mission type** — the core question, asked explicitly, never defaulted:
  - *Findings-only* (autoqa-style): teams never fix, never commit; every
    confirmed finding becomes a filed issue; a separate dedicated fixer
    session (autoissuefixer-style) optionally works the backlog.
  - *Feature development*: Leads/Principals actually implement, test, and
    open PRs.
  - *Mixed*: some teams find, some build — ask per team if so.
  If findings-only or mixed: ask whether they want the dedicated fixer
  session at all, and if yes, what its merge policy should be (auto-merge
  on passing tests vs always-hold-for-human vs risk-tiered like the
  source's security-hold).
- **Platforms/domains** — which surfaces do teams drive? Offer web,
  Android, iOS, backend/API, data as starting options but treat "other" as
  genuinely open (CLI tools, embedded, ML pipelines, docs sites — whatever
  they say). This list is per-user, not per-skill.
- **Teams/rotations** — how many, and what does each one own? One QA team
  is a perfectly valid answer; so is ten specialized rotations. For each
  team get: a short name (becomes its skill name and roster entry), its
  focus/mission, and which platform(s) it touches. Do not suggest a
  specific count or copy the source's ten-rotation roster.

## Phase 3 — Org shape and topology

Cover:

- **Per-team structure** — does every team get one Lead + N Principals
  (one Principal per platform, like the source), or does complexity vary
  (a single-session team for a simple domain; three Principals for a team
  spanning three platforms)? Ask per team if Phase 2's answers suggest
  variance. A "team" of one session (no Principals) is valid — model it on
  the source's issue-fixer single-session pattern.
- **Session naming** — propose names derived from their team/platform
  answers (e.g. `lead-<team>`, `<team>-<platform>`), show the full
  proposed name list, let them edit. Warn about the source's known
  substring caveat: session names that are prefixes of each other (like
  `exampleapp` / `exampleapp-ios`) false-positive `await-acks.sh` greps —
  prefer non-prefix names, or note the exact-match-grep workaround in the
  generated team skills.
- **Roster order** — in what order do teams take turns? Confirm the strict
  round-robin model (one team at a time, director-serialized) fits their
  goal; if they explicitly want something else (always-on, parallel teams),
  honor it but state the RAM cost plainly (this is the exact failure the
  source redesign fixed) and get an explicit confirmation.

## Phase 4 — Concrete specifics (real strings, no placeholders)

Cover — every answer here gets baked literally into generated files:

- **GitHub org/repo per platform/team.** The actual `org/repo` strings
  (e.g. where web issues get filed, where the iOS code lives). If their
  code isn't on GitHub, ask what they use instead and adapt the
  issue-filing/journaling sections of generated skills accordingly.
- **Journal/discussion target.** Where should activation journals and
  run summaries go? Options: GitHub Discussions (the source's choice —
  needs a thread per writer, generated skills will include the
  `gh api graphql addDiscussionComment` recipe), GitHub Issue comments,
  Slack, a local markdown file in the registry folder, or something else.
  Ask; don't assume Discussions.
- **Local directory layout.** Their machine will NOT have
  `~/Documents/exampleapp`-style paths. Ask for:
  - the local checkout path of every repo a Principal will cwd into;
  - a base folder for the system's own state (recommend
    `~/Documents/<systemname>-registry/` for DIRECTOR-STATE.md,
    director-log.md, and per-team shared folders as siblings like
    `~/Documents/<systemname>-<team>/` — but this is a recommendation
    they can override wholesale);
  - the director session's own cwd (recommend a dedicated empty folder).
  Show the full proposed directory tree and let them adjust before moving
  on.
- **Model tiers per role.** Ask what models are actually available in
  their environment — Bedrock ARNs/inference profiles, plain
  `sonnet`/`opus`/`haiku`/`fable` CLI shortcuts, or neither (some
  environments must omit `--model` entirely and inherit `ANTHROPIC_MODEL`).
  Then ask which tier each role gets: director session, Leads, Principals,
  fixer planner/worker if applicable. Generated spawn scripts pin exactly
  what the user chose — including generating NO `--model` flag at all if
  the user says their environment breaks on model shortcuts.
- **Test/dev environment specifics** — ONLY if the mission involves real
  interactive testing: test account credentials (and where they live), dev
  server URL/port, dev-vs-prod backend boundaries (what's safe to write
  to), simulator/emulator needs. Skip this entirely for missions that
  don't drive a live app.
- **Lifecycle expectations.** Default and recommendation: on-demand
  spawn/teardown with a director safety timeout (~90 min, ask if they want
  a different bound) and a per-activation cycle count (the source uses
  exactly 2 back-to-back cycles — ask). If they want always-on sessions
  instead, restate the freeze incident and confirm explicitly.

## Phase 5 — Confirmation gate (nothing is written before this)

Present one consolidated summary and get an explicit go-ahead via
`AskUserQuestion` before ANY file write, `mkdir`, or `tmux` command:

1. **The roster table** — position, team name, slash command, session
   names, cwds, shared folder, mission type — in the same table shape as
   the source director's roster.
2. **The directory tree** that bootup.sh will `mkdir -p` (registry folder,
   per-team shared folders, director cwd, any Lead cwds).
3. **The file list** to be written under `~/.claude/skills/` (every path,
   one line each, marked new vs overwrite-with-backup).
4. Key policy choices restated: mission type(s), fixer yes/no + merge
   policy, journal target, model tiers, lifecycle model, safety timeout.

Offer: proceed / edit something (loop back to the relevant phase) / abort.
If anything material changes after this gate, re-confirm before writing.

## Phase 6 — Generation (real files, mirroring the source mechanics)

Write the files below. Every generated SKILL.md gets frontmatter with
`name`, `description`, `version: 1.0.0`, and `generated-by: canifidevsetup`
(so Phase 0 of a future re-run can find them). Substitute the user's real
answers everywhere the source has ExampleApp specifics; mirror the source's
mechanics everywhere else. Concrete strings only — if you find yourself
writing `<your-repo-here>` into an output file, you skipped an interview
question; go back and ask.

### 6.1 `~/.claude/skills/director/SKILL.md`

Mirror the source `director/SKILL.md` section-for-section, parameterized:

- The on-demand model rationale (keep the freeze-incident warning verbatim
  in spirit — it's the load-bearing "why").
- The roster table from Phase 5, in roster order, with the user's real
  team names / slash commands / session names / shared folders.
- `DIRECTOR-STATE.md` in the user's registry folder: the
  `CURRENT: round=<r> position=<1-N> team=<name> state=<...>` pointer line
  plus the append-only activation-history table (same columns: round,
  team, spawned-at, done-at, cycles-run, cleanup-confirmed, forced, notes),
  and the startup-resume rules (reconcile pointer against `tmux ls`;
  aborted activations re-run from spawn).
- `director-log.md` in the registry folder: `ACTIVATE-<n>` / `ACK` /
  `DONE-<n>` protocol, one shared monotonically-increasing counter.
- The activation protocol (spawn → verify-ready via capture-pane → brief
  Principals with FULL one-shot role briefs → ACTIVATE + nudge Lead → poll
  for DONE with the stuck-Lead heartbeat check → sanity-check DONE →
  teardown → record and advance), with the user's cycle count and journal
  target substituted in.
- The health sweep on every poll (session count vs expected baseline,
  machine-wide `pgrep -fl 'watch.sh|monitor-peers.sh|heartbeat|nudge.sh'`
  orphan check cross-referenced against DIRECTOR-STATE; add
  simulator/emulator checks only if the user's platforms include them),
  log-only-on-anomaly.
- The safety timeout at the user's chosen bound, with forced-teardown
  honesty rules (`forced=yes`, never silently clean).
- The fixer gate section ONLY if the user chose a fixer: same once-per-lap
  trigger shape as the source (or the trigger cadence the user chose),
  with their repos/labels/merge policy substituted.
- The tmux group-name gotcha and the "what the Director never does" list,
  adapted to the user's session names and shared infra.

### 6.2 One `~/.claude/skills/<team>/SKILL.md` per team

Adapt from `autoqa/SKILL.md` (findings-only teams) or from its structure
with the mission swapped (feature-development teams), on top of the shared
protocol:

- Session bootstrap table (roles, exact session names, cwds) and the FULL
  one-shot role brief contents (role, session name, cwd, "read this
  SKILL.md then the coordination skill in full", the team's write policy
  verbatim, shared folder path, "wait for the start directive").
- Shared folder layout: `acks.md`, `lead-log.md`, `heartbeat.md`,
  per-cycle plan + per-cycle append-only `<role>-<platform>.md` logs, plus
  the mission-appropriate continuity file:
  - findings-only → a coverage `LEDGER.md` (stalest-first selection,
    seeded from the user's app surface) + `filed-issues.md` (Lead-owned,
    dedup index, mandatory cycle-close reconciliation against the real
    issue tracker);
  - feature-development → a `BACKLOG.md`/work-queue equivalent (source of
    what to build next, where it comes from per the user's answers) and a
    `shipped.md` index of PRs opened/merged, with the same
    Lead-is-sole-writer and reconcile-against-GitHub disciplines.
- Cycle structure (plan → distribute → execute → file-issues-or-open-PRs →
  close), the incremental-logging rule, backend-verify/no-fake-writes
  discipline (for testing missions) or real-test-before-PR discipline (for
  building missions).
- The Director-activation section: ACK-first, exactly N cycles, no
  self-scheduling ever, and the full deactivation/cleanup protocol (kill
  own background jobs, platform-specific cleanup only for the platforms
  this team actually drives, `pgrep -f <session-name>` before claiming
  `cleanup=confirmed`, one journal entry to the user's chosen target,
  DONE line + nudge director, stop).
- Compaction/heartbeat/degenerate-output hygiene, citing the shared
  coordination skill rather than restating it.

### 6.3 Shared coordination skill

Two parts:

- **Scripts — copy, don't rewrite.** `nudge.sh`, `ack.sh`, `watch.sh`,
  `await-acks.sh`, `monitor-peers.sh` are already fully generic
  (parameterized by session name / file path) and ship bundled at
  `$PLUGIN_ROOT/skills/canifidevsetup/scripts/`. `cp` them straight from there
  into the generated coordination skill's `scripts/` dir, `chmod +x`. No
  external path is ever needed for this.
- **`SKILL.md`** — a generalized `reference/cross-platform-testing.SKILL.md`: the
  Lead+Principals topology diagram, shared-folder file protocol, the
  three-part delivery guarantee (write directive → nudge → background
  ack-watcher), read-before-you-watch and explicit-timeout rules with the
  WRONG/RIGHT example, the tmux idle-session nudge pattern, compaction and
  heartbeat protocols (including the no-nohup rule and its incident), and
  the no-fake-writes discipline. Strip the ExampleApp platform-specific
  notes sections; add per-platform notes sections ONLY for the platforms
  the user actually chose, seeded from the source's notes where the
  platform matches (iOS/web) and left as honest "fill in as you learn"
  sections where it doesn't.

Name this skill something neutral derived from the user's system name
(e.g. `<systemname>-coordination`); every team SKILL.md and the director
reference it by path.

### 6.4 `~/.claude/skills/director/scripts/spawn-team.sh` + `teardown-team.sh`

Generate from the source scripts' exact idioms with the user's roster baked
in:

- `spawn-team.sh <team>`: the `case "$TEAM"` block enumerating the user's
  real teams → session names + cwds; the group-aware `session_exists()`
  (copy the awk line exactly); `launch()` with `mkdir -p`, no
  `--continue`, and the user's chosen model flags (or none); the
  ready-prompt wait note.
- `teardown-team.sh <team>`: the same `case` block → session arrays;
  `kill_matching()` copied exactly (name-or-group match, SKIP on absent);
  the `pgrep -f "$s"` orphan safety-net loop with its incident comment
  preserved in condensed form. Scoped strictly to that team's names —
  never an allowlist sweep; the user's own standing session names never
  appear in any kill path.
- If the user chose a fixer: `spawn-issue-fixer.sh`/`teardown-issue-fixer.sh`
  equivalents (their fixer's session name/cwd/model), mirroring the
  single-session source pair. If the fixer's inner pipeline needs a
  workflow script, generate the fixer's SKILL.md describing the pipeline
  (adapted from `autoissuefixer/SKILL.md`: batch discovery from their
  tracker, per-issue contracts, real-test-before-merge, consecutive-failure
  circuit breaker at 2, their merge policy) and note honestly that the
  workflow implementation is a follow-up the user drives — don't fabricate
  a `issue-fixer-workflow.js` you can't test.

All generated scripts: `set -euo pipefail`, `chmod +x` after writing, and
run `bash -n <script>` on each as a syntax check before reporting done.

### 6.5 `~/.claude/skills/<systemname>-bootup/scripts/bootup.sh` (+ its SKILL.md)

Mirror the source `bootup.sh`:

- `mkdir -p` every directory confirmed in Phase 5 (registry, shared
  folders, director cwd).
- The group-aware `session_exists()` and `launch()` (copied exactly),
  creating ONLY the director's standing session (plus any always-on
  sessions the user explicitly asked for in Phase 4 — never the teams'
  sessions; the director spawns those on demand). `--continue` only on
  general-purpose panes the user asked to include, never on the director
  or any role session.
- The `is_fresh` array + `trigger_lead` retry-and-verify block (copied
  exactly, including the C-u clear and the capture-pane `❯` check),
  triggering `/director` only when the director session was freshly
  created this run.
- A short companion SKILL.md documenting what it creates and the
  small-footprint rationale.

### 6.6 Verify

After writing everything: `bash -n` every script; re-read each generated
SKILL.md's roster/paths against the Phase 5 summary; confirm no ExampleApp
string (`exampleapp`, `example-web-repo`, `exampleorg`, `exampleapp-ios`) survives in
any generated file unless the user's own answers genuinely contain it
(`grep -ril` across the generated files). Report any mismatch and fix it
before Phase 7.

## Phase 7 — Handoff (generate, don't execute)

The bootstrap is written, NOT run. Mirror the source's own pattern: bootup.sh
is meant to be executed by the human (or a future session) after a restart,
not autoexecuted mid-generation.

1. Print the exact command: `~/.claude/skills/<systemname>-bootup/scripts/bootup.sh`,
   and what it will do (the mkdir list, the one director session, the
   `/director` trigger).
2. Then ask ONE explicit yes/no via `AskUserQuestion`: "Want me to run it
   now?" Only on an explicit yes do you execute it (and report its
   SKIP/STARTED/TRIGGERED output verbatim — that output is the
   authoritative record, per the source bootup SKILL.md). On no: stop
   cleanly; the system is fully generated and ready whenever they run it.
3. Either way, close with the file list actually written (absolute paths)
   and a one-paragraph "how this runs day to day" recap grounded in their
   answers.

## Honesty discipline

- Never claim the generated system "works" — you have not watched a full
  activation run. Say exactly what you verified: files written, scripts
  syntax-checked, paths/roster consistent with the confirmed design.
- If an interview answer makes a source mechanic inapplicable (no GitHub,
  no tmux-capable terminal, an OS without `pgrep -f` semantics), say so and
  adapt or flag it — don't generate machinery that can't run on their
  machine.
- If the user asks for something this skill's constraints warn against
  (always-on teams, detached watchers), warn once with the real incident,
  then honor their explicit choice and record the deviation in the
  generated director SKILL.md so a future session knows it was deliberate.
