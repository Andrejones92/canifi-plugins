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

**On-demand teams, spend tracking, and a status dashboard (Phase 4/6) have
NO bundled reference file, deliberately.** These are optional systems you
author from the mechanism described in Phase 6, built to fit THIS user's
own answers — not mirrored from a source file, because there isn't one to
mirror. If you find yourself trying to recall or approximate a specific
prior implementation of any of these three instead of building one fresh
from the user's Phase 4 answers, stop — that is exactly the failure mode
this skill exists to avoid. `reference/` is an example to adapt for the
mechanics it DOES cover, never a template to clone, and for these three
systems there is no template at all.

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

### Platform check — do this first

The system this skill generates drives a **terminal multiplexer**: the director spawns
each team as sessions and tears them down afterwards. Which multiplexer depends on the
user's platform, so establish that before spending an interview on it.

Ask the user directly. Do not shell out to detect it — on native Windows without Git for
Windows there is no Bash tool at all.

| Platform | Multiplexer | Scripts to generate |
| --- | --- | --- |
| macOS, Linux | `tmux` | `.sh` (bash) |
| Windows + WSL 2 | `tmux` inside WSL | `.sh` (bash), everything on the WSL filesystem |
| Native Windows | [`psmux`](https://github.com/psmux/psmux) | `.ps1` (PowerShell) |

**psmux** is a native Windows tmux built in Rust — PowerShell 7+, cmd.exe and Windows
Terminal, no WSL/Cygwin/MSYS2 required. It implements the full command surface this
system depends on: `new-session -d -s`, `send-keys -t`, `has-session -t`,
`list-sessions -F`, `capture-pane -p`, `kill-session`, and `display-message -p`.

If the user is on native Windows and does not have it, point them at the repo and stop
until it is installed. Do not generate a half-working system.

#### Two adaptations for the psmux path

1. **Generate `.ps1`, not `.sh`.** Every spawn/teardown/nudge/ack/watch script becomes
   PowerShell. Keep the logic identical — only the shell changes. `psmux` is a native
   executable, so the command lines themselves are unchanged.

2. **Drop `#{session_group}` from existence checks.** On macOS the group-aware check
   exists solely to defend against **iTerm2's** tmux integration, which creates numbered
   siblings (`lead-9`) inside a session *group* that plain `has-session` misses. iTerm2
   is macOS-only, so on Windows there is no group to miss and `#{session_group}` is not
   a documented psmux variable. Match on `#{session_name}` alone there. Everywhere else,
   keep the group-aware check exactly as the reference scripts have it — it exists
   because of a real duplicate-session incident.

Everything else — ACK-before-act, on-demand spawn/teardown, no detached background
processes, the orphan sweep on teardown — carries over unchanged.

> Not yet verified on real hardware. The command surface is confirmed against psmux's
> compatibility matrix, but no one has run a full director lap on Windows. Say so if the
> user asks, and treat the first Windows run as a shakedown.

`/canifi:council` and `/canifi:canifilifesetup` have no multiplexer dependency and work
on every platform.



### Resolving this plugin's own files

**Do not use shell commands for this.** `$CLAUDE_PLUGIN_ROOT` is not exported into the
Bash tool, and on native Windows without Git for Windows there is no Bash tool at all —
Claude Code uses PowerShell there. Use the **Glob tool**, which behaves identically on
macOS, Linux, WSL and Windows.

Glob for the marker file that only ever exists inside this plugin:

```
Glob  pattern: **/plugins/**/canifi/**/skills/council/council-cost-lib.js
```

If that returns nothing, widen to `**/skills/council/council-cost-lib.js`.

Take the match with the **highest version segment** in its path (paths look like
`.../plugins/cache/canifi/canifi/0.3.0/skills/...`; compare numerically, so `0.10.0`
beats `0.9.0` — never compare these as plain strings). `PLUGIN_ROOT` is everything
before `/skills/`.

Use `PLUGIN_ROOT` for every bundled file from then on, and always join paths with `/` —
Claude Code's file tools accept forward slashes on Windows.

If Glob returns no match at all, stop and tell the user the plugin install looks
incomplete and to try `/plugin install canifi` again. Never guess a path, and never
fall back to a hardcoded `~/.claude/...`, which is wrong whenever `CLAUDE_CONFIG_DIR`
is set.


### Preflight steps

1. **Confirm the bundled reference material exists.** Using `PLUGIN_ROOT` from above,
   Glob for `PLUGIN_ROOT/skills/canifidevsetup/reference/**` and
   `PLUGIN_ROOT/skills/canifidevsetup/scripts/**`. If either is empty, tell the user
   plainly and stop — this plugin's install is incomplete and generation has no
   authority to mirror without it. Do not fall back to searching for or requesting an
   external export; the reference material ships inside this plugin and there is no
   other legitimate source.

2. **Check for prior runs.** Does a previously generated system already exist? Glob for
   `**/skills/director/SKILL.md`, and for any skill carrying a
   `generated-by: canifidevsetup` line in its frontmatter. If yes, ask the user up front:
   update/regenerate, or abort. **Never silently overwrite.** If regenerating, back up
   each file to `<file>.bak.<epoch>` before writing.

3. **Confirm the dependencies for their platform.**
   - macOS/Linux/WSL: `tmux` and `gh`
   - Native Windows: `psmux` and `gh`

   Missing `gh` only matters if the interview later lands on GitHub for issues or
   journaling — note it, don't block yet. A missing multiplexer **does** block: without
   it nothing the wizard generates can run.

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
- **Auxiliary systems, at a high level.** Ask, as open/closed questions
  batched together, whether they want any of these three optional systems
  the source has (each gets a real interview in Phase 4, and each is
  independently optional — say yes to any subset):
  - **On-demand teams** — single-session helpers the user can invoke by
    name outside the round-robin (e.g. "make this change to my marketing
    site", "review my parked issues"), spawned/briefed/torn down on
    request, running alongside the round-robin without pausing it.
  - **Spend tracking** — automatic per-activation dollar-cost logging plus
    a way to ask for totals/averages later.
  - **Status dashboard** — a live page (or other view) showing what the
    round-robin is doing right now.
  A "no" to any of these is a completely valid, common answer — skip that
  system's Phase 4 questions and Phase 6 generation step entirely rather
  than generating a stub nobody asked for.

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
- **Model tiers per role — ask, then recommend, never hardcode.** First ask
  what models are actually available in their environment — Bedrock
  ARNs/inference profiles, plain `sonnet`/`opus`/`haiku`/`fable` CLI
  shortcuts, or neither (some environments must omit `--model` entirely and
  inherit `ANTHROPIC_MODEL`). Then, for each role that exists in THEIR
  design (director/orchestrator session, Leads, Principals, an on-demand
  team's single session, a fixer's planner vs. worker split if
  applicable), **give a concrete recommendation and ask them to confirm or
  override it** — don't just ask an open "what tier?" and don't silently
  default to whatever tier the source happens to use today. A reasonable
  starting recommendation to offer (state it as a recommendation, not a
  given): orchestration-only sessions that never write code can run on a
  cheaper/faster tier since their job is coordination, not judgment;
  sessions that make real judgment calls (deciding whether a finding is
  real, writing a fix, merging code) warrant a stronger tier; a fixer that
  writes and merges code unattended is the one place worth paying for the
  strongest tier available, since it is the part of the system acting
  without a human in the loop. Record their actual choice per role — this
  is what generated spawn scripts pin, and it is exactly the kind of thing
  that changes over time as the user's own preferences change, so make it
  trivial to find and edit later (one clearly-labeled place per generated
  script) rather than scattered.
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
- **On-demand teams — only if Phase 2 said yes.** For each on-demand team
  they want:
  - a short name and one-line mission (what request does this team handle?);
  - the repo/cwd it works in, and the branch it commits to (or "no repo" for
    something like a dashboard-only or docs-only helper);
  - is it a one-shot job (spawn, do the thing, report, teardown) or
    **iterative** (stays alive across a session so the user can send
    follow-up requests before it tears down)?
  - anything it must NEVER do unattended (e.g. "never merge to main", "never
    deploy") — restate back what the team's write boundary is and get
    explicit confirmation.
  Do not assume any specific on-demand team exists — a user with zero
  auxiliary repos may want none, and a user with many side projects may want
  five. Whatever list they give becomes their own on-demand-teams config
  (see Phase 6) — never seed it with the source's own teams.
- **Spend tracking — only if Phase 2 said yes.** Ask, don't assume:
  - Do they want cost estimated from real token/transcript data, or is a
    rougher proxy (session duration, activation count) acceptable? Real
    dollar pricing needs a per-model rate table — ask if they already have
    one (e.g. from other tooling) or want a simple placeholder they can fill
    in with their actual provider's rates later.
  - Where should the running log live, and in what format (plain
    append-only text like the rest of this system's own files, a CSV, a
    JSON-lines file)? Recommend a plain append-only text file in their
    registry folder, consistent with `director-log.md`/`DIRECTOR-STATE.md`,
    unless they want something else.
  - What questions do they actually want to ask of it later ("total this
    week", "average per team", "most expensive rotation")? This shapes what
    the query tool needs to compute — don't build more than they'll use.
- **Status dashboard — only if Phase 2 said yes.** Ask, don't assume:
  - What form? A locally-served web page, a static file they open by hand,
    a terminal status command, something else. If a served page, ask how
    they want to reach it (localhost only, their own LAN, a VPN/mesh
    network like Tailscale if they already use one, something else) — do
    not assume any specific hosting mechanism.
  - What should it show — current position/team/state at minimum; ask if
    they also want spend-to-date, recent history, or per-team stats
    surfaced (only offer these if spend tracking above was also chosen).
  - **The controlled-vocabulary contract, regardless of form chosen:**
    whatever file or channel the director writes its "what's happening
    right now" pointer to, and whatever reads it to render the dashboard,
    are two independent processes agreeing on a plain-text contract, not
    prose being interpreted by a human. Get explicit agreement in the
    interview on: the exact field names, the exact fixed set of allowed
    values for any "state" style field, and where free-form narrative is
    allowed to go (never inside a matched field, always in a separate
    prose/notes portion). State this plainly to the user: a renderer that
    matches on an exact string will silently misreport if the writer ever
    puts descriptive text into that field instead of one of the agreed
    tokens — this is a real, easy-to-make mistake worth naming up front so
    the generated writer and reader agree on the same fixed vocabulary from
    the start, not after the first misreport.

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
   policy, journal target, model tiers (per role, with the recommendation
   they confirmed or overrode), lifecycle model, safety timeout, and
   whichever of on-demand teams / spend tracking / status dashboard they
   opted into (with their concrete answers for each — team list, log
   format, dashboard form/hosting) or explicitly declined.

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

### 6.6 On-demand teams — ONLY if the user opted in during Phase 4

**There is no bundled reference implementation for this — author it fresh
from the user's own answers, the same way you'd write any other feature
from a spec.** The source system happens to have its own on-demand-team
scripts, but they are not bundled with this skill and must not be
approximated from memory or copied from anywhere; what you generate here
should be buildable correctly for a user whose setup looks nothing like the
source, using nothing but the mechanism described below and their Phase 4
answers.

Generate:

- `~/Documents/<registry>/ondemand-teams.conf` (or whatever config format
  fits the user's other choices) — one entry per team from Phase 4: name,
  session name, cwd, skill/command to load, model tier, repo, branch,
  one-line summary. This file is the single source of truth; the spawn/
  teardown logic below reads it rather than hardcoding each team.
- A spawn script and a teardown script (in the platform's script language
  from Phase 0) that: look up a team by name in the conf; create/kill
  exactly ONE tmux (or psmux) session for it, matching by exact session
  name (and session group on macOS, per the group-aware pattern used
  elsewhere in this system); never touch any other session. Idempotent
  (spawning an already-running team is a no-op; tearing down an absent one
  is a no-op).
- A short SKILL.md (or a section of the director's own SKILL.md — either is
  fine, ask if unsure) describing the protocol: spawn → brief with the
  user's verbatim request + a fresh id → wait for its own DONE line in the
  shared log → relay the result to the user → teardown (or keep alive, for
  teams the user said are iterative). State plainly that this runs
  alongside the round-robin without pausing, delaying, or consuming a
  roster turn.
- If Phase 4 flagged a genuinely shared, non-multiplexable resource this
  user's setup would hit (a fixed debugging port a browser-automation tool
  needs, a rate-limited external API, a single physical device) — note the
  serialization rule in the generated docs. Only include this if it's
  actually applicable; don't invent a hazard the user's stack doesn't have.

### 6.7 Spend tracking — ONLY if the user opted in during Phase 4

Same rule as above: **write this from the mechanism, not from a copy.**
The mechanism is straightforward and buildable for any setup: a Claude Code
session's own transcript file (JSONL, one line per turn, includes token
counts and a model identifier) is enough to compute a real dollar figure
given a per-model rate table, and a role's cwd is enough to find its
transcript directory.

Generate, matching the user's Phase 4 answers:

- A pricing script that, given a role's cwd (and optionally a time window),
  finds its transcript file(s) and computes a cost from token counts × the
  user's rate table. If the user didn't have real rates, generate a
  clearly-labeled placeholder rate table they can fill in, and say so
  explicitly in the handoff — don't fabricate real-looking numbers from
  invented rates.
- A logging step wired into the team/on-demand teardown scripts (their
  last step, non-fatal on failure — a pricing hiccup logs `unknown` for
  that role rather than blocking teardown) that appends one line per
  activation to the user's chosen log file.
- A stats/query script answering the specific questions the user said they
  wanted in Phase 4 (totals, averages, per-team breakdowns, whatever they
  asked for specifically — no more).
- Note in the handoff that this is best-effort: pricing depends on the
  transcript format and rate table staying accurate, and any historical
  activations from before this was generated are not retroactively priced
  unless the user asks for that as a separate follow-up.

### 6.8 Status dashboard — ONLY if the user opted in during Phase 4

Same rule again: **build the specific form the user chose in Phase 4** (a
served local page, a static file, a terminal command, whatever they said) —
do not assume a particular server framework or hosting mechanism they
didn't ask for.

Generate:

- The renderer/server itself, in whatever the user's environment
  comfortably supports (ask if unclear rather than guessing a language/
  framework), reading whatever pointer file the director writes its current
  state to.
- If the user chose network-reachable hosting beyond localhost (their own
  LAN, a mesh network like Tailscale, anything else) and doesn't already
  have that set up, include a short preflight note in the handoff — what
  they need to install/configure and confirm working BEFORE the dashboard
  can be reached that way — rather than silently assuming it exists.
- **The controlled-vocabulary contract, generated on both sides at once.**
  Define the exact field names and the exact fixed set of allowed values
  for the director's "current state" pointer (per the Phase 4 agreement),
  write the director's own pointer-writing instructions to use ONLY those
  exact tokens with free narrative confined to prose after a separator
  (never inside a matched field), and write the renderer to match those
  same exact tokens. Generating both halves together in the same pass is
  what keeps them from drifting apart — a renderer written against a
  vocabulary the writer doesn't actually use is a bug baked in at birth.

### 6.9 Verify

After writing everything: `bash -n` (or the platform-equivalent syntax
check) every script; re-read each generated SKILL.md's roster/paths against
the Phase 5 summary; confirm no ExampleApp string (`exampleapp`,
`example-web-repo`, `exampleorg`, `exampleapp-ios`) and no source-specific
string from the on-demand/spend/dashboard mechanics above (anything that
looks like it was copied from another user's setup rather than generated
fresh from this user's own answers) survives in any generated file unless
the user's own answers genuinely contain it (`grep -ril` across the
generated files). Report any mismatch and fix it before Phase 7.

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
