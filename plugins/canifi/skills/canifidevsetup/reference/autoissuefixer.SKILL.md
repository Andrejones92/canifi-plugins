---
name: autoissuefixer
description: Batch-serialized autonomous GitHub issue fixer for the ExampleApp apps. Runs in ONE tmux session (`auto-issue-fixer`, Sonnet-medium, no Web/iOS Principals of its own) that the director spawns fresh as a gate once per round-robin lap (right before autoqa's turn comes back around, after every other team has had exactly one activation) and tears down right after — this keeps the Workflow tool's triage/fix/review complexity out of the Director's own context. Any open issue carrying one of the 10 autoX labels is eligible on its own; `autosecurity` issues additionally need the manually-applied `clear` label before the fixer will even triage them. Issues already carrying `autofix-needs-review` (the park label) are excluded from discovery, regardless of rotation, until a human clears that label. Inside the Workflow: Fable 5 at medium effort triages a batch into a minimal-sufficiency contract (the planner tier gets extra reasoning budget since a weak contract propagates errors downstream); ONE Fable 5 (low effort) agent per platform then works through up to 20 issues for that platform in a single call — fix, real interactive test against the real app/simulator, commit, PR — no merge yet (web and iOS run in parallel with each other, never two of the same platform at once). Fable 5 (low effort) then reviews each PR: the default verdict is clean, in which case Fable itself finalizes it (merges into working-branch/dev + closes the issue, or holds autosecurity PRs for manual review) — but if Fable finds something extremely risky, it gets exactly ONE corrective commit before a fresh Fable-low agent re-tests interactively, never merging its own unverified amendment. Two consecutive parked (failed-twice) issues halts the whole run and pauses the Director for the user. Use when the user says "auto issue fixer", "fix the open issues", "run the issue fixer", or references this skill — but normally this runs automatically, triggered by the director, never on a fixed schedule of its own.
version: 5.3.0
---

# Auto Issue Fixer — batch-serialized fix/test/merge pipeline

Every other `autoX` rotation in this system (autoqa, autosecurity, autoaccessibility,
autodesign, autoperf, autolocalization, autoresilience, autoanalytics,
autointeroperability, autoparity) is strictly **findings-only** — it never
fixes anything, never commits. This skill is the one place in the whole
system that actually changes code, tests it for real, and merges it. It
exists because those 10 rotations produce a steady stream of GitHub issues
that would otherwise just pile up forever with nobody acting on them.

**This skill runs in ONE tmux session, `auto-issue-fixer`** — unlike the 10
rotations (Lead + Web Principal + iOS Principal, three sessions each), it
has no Principals of its own, because the actual fixing/testing work happens
inside `Workflow` agent() calls (background, harness-managed, NOT additional
persistent tmux+Claude processes — spinning up more tmux sessions for that
would repeat the exact resource mistake that forced the Director's
on-demand spawn/teardown redesign in the first place). The Director spawns
this ONE session fresh right before every gate-triggered run and tears it
down right after, exactly like it does for a team — see
`~/.claude/skills/director/SKILL.md`'s "Issue-Fixer Gate" section, which is
the authority on that lifecycle. **This session's whole job is to hold the
`Workflow` call** (mint the docs dir, launch it, wait for its own
`<task-notification>`, report the result) so that complexity never has to
live inside the Director's own context — the Director's job stays "spawn,
brief, wait, teardown," identical in shape whether it's activating a team or
this.

## Session bootstrap

| Role | tmux session | cwd |
| --- | --- | --- |
| Auto Issue Fixer | `auto-issue-fixer` | `~/Documents/auto-issue-fixer` |

Spawned by `~/.claude/skills/director/scripts/spawn-issue-fixer.sh` and
torn down by `teardown-issue-fixer.sh` — you should never need to create or
kill this session yourself. Launched with `claude
--dangerously-skip-permissions --model sonnet --effort medium`, no
`--continue`: every run starts completely blank and is briefed fresh by the
Director (this run's `runId` is in that brief) — never from prior
transcript history. This OUTER session's own model (Sonnet-medium) is
separate from the Fable-tier models used INSIDE the Workflow's own
agent() calls (Triage/Fix/Review/Retest) — this session just holds the
Workflow call, reads its result, and posts the journal/DONE report. All
continuity this skill needs (which issues were already parked, prior run
history) lives in GitHub itself (labels/comments) and
`~/Documents/auto-issue-fixer-docs/`, never in session memory.

Read `the Council skill (`/canifi:council`)` first — this skill borrows its
core pattern directly: a planner tier writes a **minimal-sufficiency
contract** per unit of work (files allowlist, acceptance criteria,
out-of-scope denylist, integration note), a worker tier builds against that
contract, and a review pass is **observability only** (comments, never
blocks). The differences from Brandon: no interactive discovery (this is
fully automatic, triggered by the Director finding open issues, not a user
request), and the model tiers are (as of 2026-07-24): the Triage
(planner) tier runs **Fable 5 at MEDIUM effort** — a weak contract
propagates errors into every downstream stage, so this one tier gets extra
reasoning budget; Fix, Review, and Retest all run **Fable 5 at LOW
effort** (earlier versions used Sonnet 5 at medium effort for the worker
tier, but an all-Fable-low setup for those three stages proved out in
production at real scale — batches of up to 20 issues per platform,
completed correctly with thorough interactive test evidence — and was
adopted as the permanent config for them). Round-batches are still strictly
serialized (round 2 doesn't start until round 1 fully settles, since the
consecutive-park counter carries state forward), but WITHIN a round, one
Fable call per platform now handles that platform's WHOLE sub-batch
(up to 20 issues) in a single conversation rather than one call per issue —
because each fix needs a real interactive test against a real simulator or
browser, and this system has already learned the hard way what happens when
too many of those run at once (never two web fix-agents or two iOS
fix-agents concurrently).

## When this runs

The Director checks for eligible open issues **once per round-robin lap** —
right before autoqa's turn comes back around, after every other team has
had exactly one activation (never before positions 2-10, and never before
round 1's very first-ever activation, since "all teams have run once" isn't
true yet then) — see `~/.claude/skills/director/SKILL.md`'s "Issue-Fixer
Gate" section, which is the authority on the trigger condition and
repos/labels. In short: any open issue across both repos carrying one of
the 10 `autoX` labels, that does NOT already carry `autofix-needs-review`
(the park label), makes this run — with one exception below for
`autosecurity`. No issue-count threshold beyond that — even one issue
triggers it. It genuinely pauses the whole round-robin: no other
rotation's sessions exist while this runs.

**`clear` is required only for `autosecurity` issues — every other autoX
label is eligible on its own, no `clear` needed.** The 10 read-only
rotations file issues continuously and autonomously; for non-security
findings, the fix/test/merge pipeline itself (real interactive test,
review pass, auto-merge only on a clean verdict) is the safety net, so no
extra human gate is needed before the fixer even looks at them.
`autosecurity` issues are different: `clear` means the user has personally
reviewed that specific security finding and signed off on the fixer
touching it at all — writing real code and running a real interactive test
against the real app or simulator — before the fixer will even triage it,
separately from the fact that its PR then ALSO gets held for human review
before merge (see Merge policy below). Two separate gates for
`autosecurity` specifically: `clear` decides whether the fixer touches the
issue at all; the security-hold decides whether its PR can merge
unattended. Non-security issues only ever go through the second gate
(review before merge), never the first.

## Environment facts

- **Web repo:** `exampleorg/example-web-repo`, dev branch `working-branch` (never
  `main`/production), local checkout `~/Documents/exampleapp` (the same
  checkout the 10 read-only rotations use — this skill never edits it
  directly, only via isolated `git worktree`s branched off it).
- **iOS repo:** `exampleorg/exampleapp-ios`, dev branch `dev` (never
  `main`/production), local checkout `~/Documents/exampleapp-ios`.
- **Eligible labels:** `autoqa`, `autosecurity`, `autoaccessibility`,
  `autodesign`, `autoperf`, `autolocalization`, `autoresilience`,
  `autoanalytics`, `autointeroperability`, `autoparity` — any one of these
  alone makes a non-`autosecurity` issue eligible; `autosecurity` issues
  additionally need `clear` (see "When this runs" above).
- **Clear label:** `clear` — REQUIRED alongside the `autosecurity` label
  specifically, before the fixer will touch that issue at all. Manually
  applied by the user after personal review. No `clear` label on an
  `autosecurity` issue = not eligible, full stop. Not required for any of
  the other 9 autoX labels.
- **Park label:** `autofix-needs-review` — applied to an issue that failed
  fixing twice (initial attempt + one retry). Excluded from all future
  discovery; a human has to look at it and remove the label (or close the
  issue) before the fixer will touch it again.
- **Merge policy:** every non-`autosecurity` fix auto-merges (squash,
  delete branch) the moment its own real interactive test passes — these
  are dev-only branches, confirmed never touching production, so this is
  sanctioned. `autosecurity` fixes still get built, tested, and opened as a
  PR, but stop there — a vulnerability fix gets a human's eyes before it
  lands, even in dev, since a subtly wrong security fix is its own risk.
- **Security fixes must never break functionality.** A fix that closes a
  vulnerability but denies legitimate access, breaks another role's flow,
  or corrupts a shared data shape is just as unacceptable as one that
  doesn't close the hole — it's not "clean" merely because the security
  issue itself is resolved. Both the triage contract's testPlan and the
  Review stage are required to be thorough here, not surface-level: testPlan
  must exercise every role touching the tightened rule/function (owner AND
  hero, not just whichever role filed the issue) and every legitimate access
  pattern that shares the same code path, and Review must trace those same
  implications across the diff, not just confirm the hole is closed. Both
  requirements are baked directly into `triagePrompt`/`reviewPrompt` in
  `issue-fixer-workflow.js`, not just documented here.
  **Every merge is immediately followed by `gh issue close` on that fix's
  issue** (Review and Retest stages both do this, not just the PR merge) —
  merges land on `working-branch`/`dev`, never the repo's default branch, so
  GitHub's `closes #N` in the PR body never auto-fires on its own. Skipping
  this step is exactly what caused a 2026-07-23 incident: dozens of already-
  merged issues sat open, and a full batch got re-discovered, re-verified,
  and manually closed by hand — see `NETWORK_SAFETY_RULE`-style enforcement
  now baked directly into the Review/Retest prompts in
  `issue-fixer-workflow.js`.
- **Test accounts:** `test.owner@exampleapp.test` / `test.hero@exampleapp.test`,
  pw `ExamplePass123!` (Dev Quick Login on web `/login`) — same accounts every
  other rotation uses.
- **Consecutive-park circuit breaker:** 2 parked issues in a row (not 2
  total across a whole run — 2 *consecutive*) halts the entire run
  immediately, even mid-batch, even with more issues still queued. Two
  unrelated hard bugs failing back-to-back is a plausible coincidence; two
  in a row is far more likely one systemic blocker (a broken login path, a
  dead test environment, a bad base branch) that will keep eating every
  subsequent issue for the same reason. The Director pauses entirely on
  this signal — see below.

## The pipeline (all inside `issue-fixer-workflow.js`, one `Workflow` call)

1. **Discover** (cheap Haiku agent) — lists open issues in both repos,
   filters to issues carrying one of the 10 autoX labels (an `autosecurity`
   issue also needs `clear`), minus anything already parked, tags each with
   its platform. One call, once, at the start of the run.
2. **Triage** (Fable 5, low effort) — takes up to 20 issues per platform off
   the queue (oldest-filed first), reads each issue's real body + the real
   code, and writes a minimal-sufficiency contract per issue: files
   allowlist, acceptance criteria, out-of-scope denylist, repro steps, and
   an exact **testPlan** — the specific interactive steps (login, reproduce,
   confirm resolved, spot-check 1-2 adjacent flows, MORE than spot-checks
   for `autosecurity` — see Environment facts) the fix agent must actually
   perform, not just "run the test suite."
3. **Fix** (Fable 5, low effort — **one agent() call per platform**, that
   call working through the WHOLE platform sub-batch, up to 20 issues, in a
   single conversation. Web and iOS run **in parallel with each other**
   since they use disjoint resources — Chrome/Playwright vs. the Simulator —
   with no contention between them; the constraint is never two web agents
   or two iOS agents at once, which is what would actually stack multiple
   Chrome sessions or multiple simulators. WITHIN a platform, issues are
   handled strictly one-at-a-time inside that one call: branch off the dev
   branch inside the batch's isolated `git worktree` (set up once at the
   start of the call, torn down once at the end), implement strictly inside
   the contract, run the real interactive test (a real local dev server on
   :4200 for web, driven via Claude-in-Chrome primary / Playwright fallback;
   a real booted iOS Simulator for iOS, driven via XCUITest/simulator
   automation), retry once on failure with the failure as new context, then
   either open a PR (outcome `pr-open`) or park, before moving to the next
   issue in the same call. **Does NOT merge here, even for non-security
   issues** — merging waits for the review step below. Tears down what it
   booted (dev server, simulator) once the whole batch is done. An earlier
   version instead gave every issue its own fresh call specifically to
   bound token usage per call, after a whole-batch-in-one-call design once
   ballooned to 400k+ tokens on a single call — the current setup
   deliberately re-accepts that larger per-call footprint because it was
   proven out in production at this scale (20/platform, correct, thorough
   test evidence) and is the standing tradeoff now, not a one-off.
4. **Review** (Fable 5, low effort) — reads each `pr-open` PR's diff
   against its contract. The default, expected verdict is **clean** — Fable
   itself finalizes those right there: merges + closes the issue
   (non-security) or leaves a "awaiting manual review" comment and holds it
   open, issue left open too (security). Only if Fable finds something
   **extremely risky or potentially damaging** (not nitpicks, not style, not
   minor scope creep — those get a comment and stay clean; for
   `autosecurity` PRs specifically, "breaks legitimate functionality" counts
   as extremely risky even if the vulnerability itself is closed — see
   Environment facts) does it escalate: it pushes **exactly ONE** corrective
   commit to that PR's branch, comments what and why, and marks it
   `amended-needs-retest` — it never merges its own amendment, never
   iterates on it, and never gets a second look at the same PR.
5. **Retest** (Fable 5, low effort — only runs at all if step 4 amended
   something; one call per platform covering every amended item for that
   platform, same shape as Fix) — re-runs ONLY the original `testPlan`
   against the amended code. Passes → merges + closes the issue (or holds
   for security) exactly like step 4's clean path. Fails → parked, counting
   toward the circuit breaker exactly like a Fix-stage failure — an amended
   fix that still fails is just as strong a systemic-blocker signal as a
   Fix-stage failure outright. This is the ONLY re-verification pass a PR
   gets; no second Fable review look, no third attempt.
6. Repeat from step 2 with the next batch of ≤20 per platform until the
   queue is empty or the consecutive-park circuit breaker trips.

## What YOU (the `auto-issue-fixer` session) do once briefed

The Director spawns you fresh, sends you the full brief with this run's
`runId` already minted, and then waits for your `DONE-<n>` in
`director-log.md` — same shape as a team, just one session instead of
three. Once briefed:

1. `mkdir -p ~/Documents/auto-issue-fixer-docs/{runId}/` — this is
   `args.docsDir`.
2. Resolve model ids the same way Brandon does: default to the literal
   `claude-fable-5` off Bedrock (this machine has no Bedrock — see the
   memory note on that — so the workflow script's built-in defaults already
   apply with zero extra plumbing; only pass `fableArn` explicitly if you
   have a real reason to override). Default tiers now: Discover is cheap
   Haiku; Triage is Fable 5 at medium effort; Fix, Review, and Retest are
   all Fable 5 at low effort. Don't pass
   `fixModel`/`fixEffort`/`triageEffort`/`perPlatformBatchSize` unless you
   have a specific reason to deviate from these standing defaults.
3. Launch:
   ```
   <Workflow
     scriptPath="~/.claude/skills/autoissuefixer/issue-fixer-workflow.js"
     args={{
       "runId": "{runId}",
       "docsDir": "~/Documents/auto-issue-fixer-docs/{runId}/"
     }}
   />
   ```
   (All other args — repos, branches, labels, checkouts — already default
   correctly inside the script; only pass overrides if something in this
   doc's Environment facts section has genuinely changed.)
4. The `Workflow` tool returns a runId immediately and runs in the
   **background** — this call is a **direct child of THIS session**, so
   you get a `<task-notification>` automatically the moment it finishes.
   **Do not poll or sleep waiting for it** — just let your turn end after
   launching it; you are not under `/loop`, the harness re-invokes you
   directly when the notification lands.
5. On that notification, read the return value and **post ONE
   comprehensive journal comment per platform that had any activity this
   run** — Apple Notes is retired (2026-07); journaling now goes to this
   skill's two persistent GitHub Discussions threads (web + iOS, per
   `~/Documents/autoteam-registry/DISCUSSIONS.md`'s `autoissuefixer` rows),
   delegated to a `haiku`-model subagent for token efficiency:
   ```bash
   gh api graphql -f query='
   mutation($id: ID!, $body: String!) {
     addDiscussionComment(input: {discussionId: $id, body: $body}) {
       comment { id url }
     }
   }' -f id="<autoissuefixer's web or ios discussion node id from DISCUSSIONS.md>" -f body="<your journal entry text>"
   ```
   Comment content: batches run, per-batch outcome counts (merged / pending
   security review / parked), any Fable amendments and whether their
   re-test passed, and — if `haltedForUser` — the halt reason spelled out
   plainly, since that's what the user is most likely to actually need. If
   both platforms had activity this run, post two separate comments (one
   per thread) rather than one combined comment in just one of them. This
   is YOUR detailed account of the run; the Director separately posts its
   own short round-robin-level comment (outcome counts only) to its own
   thread once it tears your session down — the two are complementary, not
   duplicates.
6. Append ONE line to `~/Documents/autoteam-registry/director-log.md`:
   `DONE-<n> autoissuefixer haltedForUser=<bool> merged=<n> pending=<n>
   parked=<n> reason="<haltReason or ->" <timestamp>` (use the SAME `<n>`
   the Director's `ACTIVATE-<n>` used). Then nudge the `director` tmux
   session (`nudge.sh director "DONE-<n> posted to director-log.md"`).
   **Your job ends there — report and stop.** Your session gets killed by
   the Director shortly after; don't linger, don't start a new run
   yourself, don't self-schedule anything.

## What this skill never does

- Never touches `main` or anything that reaches production, on either repo.
- Never merges an `autosecurity` fix without a human.
- Never merges anything without personally having watched the interactive
  test pass in this same run — a clean diff is not sufficient evidence.
- Never re-attempts a `autofix-needs-review`-labeled issue on its own — a
  human has to clear that label first.
- Never runs more than one Fable fix-agent per platform at a time (a web
  agent and an iOS agent may run concurrently — different resources, no
  contention — but never two web agents or two iOS agents together), and
  never leaves a dev server or simulator running once it moves to the next
  issue or finishes its whole platform batch.
- Never lets Fable amend a PR more than once, and never lets Fable merge
  its own amendment — an amendment is always exactly one corrective commit,
  always followed by a fresh Fable interactive re-test before any merge
  decision is made on that PR.
- Never treats an `autosecurity` label alone as eligibility — that specific
  rotation also needs the manually-applied `clear` label before the fixer
  will touch it at all. (Every other autoX label IS sufficient on its own.)
- **Never touches the host Mac's real network interfaces** — no
  `networksetup`, no `ifconfig ... down`, no disabling/reconfiguring Wi-Fi,
  Ethernet, or any other host network interface, for any reason including
  testing an "offline"/"network error" issue. Incident (2026-07-22): a
  Fix-stage agent ran `networksetup -setairportpower en1 off` /
  `-setnetworkserviceenabled "Ethernet" off` on the host to simulate offline
  conditions — that's the same network this whole machine depends on (this
  automation, SSH, Tailscale, everything else running on it), and disabling
  it can strand the host. To simulate offline/network-error conditions:
  Chrome DevTools/Playwright network conditions on web, the iOS Simulator's
  own Network Link Conditioner on iOS — both scoped to the browser/simulator,
  never the host. If neither is practical for a given issue, park it rather
  than touch host networking. This rule is baked directly into every Fix and
  Retest prompt in `issue-fixer-workflow.js` (`NETWORK_SAFETY_RULE`), not
  just documented here.
