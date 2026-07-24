---
name: council
description: >-
  Council (Opus-Planner Edition). Use when the user says "council", "run the council", or wants a discovery-to-delivery workflow on a complex task, tiered for cost: ONE interactive discovery pass, then Research -> Implementation -> Cleanup with no approval gates — Haiku for parallel fan-out (research slices, cleanup foci, contract verify), Opus at low effort for workers + judgment (scout, integrator, finalizer, most impl tasks), Opus at medium effort for synthesis only (one call — reads all research, writes every task's minimal-sufficiency contract + ADRs). A Haiku contract-verifier checks each diff against its contract (observability only, never gates). All durable state lives under ~/Documents/council-docs/{workflow-id}/.
version: 11.0.0-plugin
---

# Council (Opus-Planner, Contract-Bound)

The user-facing flow is one interactive **discovery** pass, then ONE background **Workflow** that runs Research → Implementation → Cleanup with **no approval gates**. Underneath: each unit of work runs on the model that fits it best, at a fixed effort per tier, and the plan binds every worker to a minimal-sufficiency contract.

**Why tiering via `agent({model, effort})`:** the Workflow `agent()` `model:` option pins each agent to an explicit model instead of silently inheriting the session default, and sets an explicit **effort** per tier — because we set effort per `agent()` call in our own script, session-wide ultracode/xhigh never applies. The skill passes plain model ids as `haikuModel`, `opusModel`. Worker and Planner now run the SAME model (Opus) — **effort is the only dial that separates them.**

**Locked effort ladder (in `council-workflow.js`):** Haiku (discovery/cleanup/contract-verify) = **high**; Worker (Opus — scout, librarian, reconciler, integrator, finalizer, most impl tasks) = **low**, flat, no per-role override; Planner (Opus — plan synthesis) = **medium — never xhigh** (plan synthesis is bounded; xhigh just burns thinking tokens).

**The core insight:** the design principle is **quality from structure, not per-worker intelligence**. The planner plans; Haiku does cheap parallel research/verify labor; the low-effort Opus workers build. Workers are *prompt-bound*, so the single biggest lever is that **the planner writes a minimal-sufficiency contract for every task** — exact files allowlist, acceptance-criteria checklist, out-of-scope denylist, integration note, research-already-done refs, and a hard-ceiling clause. That contract is a FLOOR (do all of it) and a CEILING (nothing beyond it) so a cheaper-effort worker spends exactly the tokens the task requires.

**Contract verifier (observability only):** after each worker, a **Haiku** agent checks the diff against its contract and records `met | under | over | both` + specifics. It **never blocks, retries, or edits** — the workflow always completes. Violations are aggregated into the final return (`contractCompliance`, `contractViolations`) and written to the checkpoint's `## Contract Compliance` section + the handoff, so the user is made aware of any drift.

## Reasoning & Honesty Discipline

When state is ambiguous (partial checkpoint, an in-flight run), read the checkpoint rather than fabricating state. Never claim a phase passed without evidence — the workflow's verify stages capture exact exit codes; relay those. Treat empty tool output as empty. The model-tier split is real data: relay the per-agent token totals from `/workflows`, don't estimate.

---

## The Stage Map (so you can explain the run shape)

Each workflow agent is launched with an explicit `agent({model, effort})` tier. Opus at medium effort runs the one plan-synthesis call; Opus at low effort handles workers + judgment; Haiku handles the cheap parallel fan-out + contract verification.

| Stage | Model · effort | What happens |
|---|---|---|
| Discovery (this main session) | session default | Interactive judgment — unchanged |
| Scout | Opus · low | Sizes 3–12 slices; tags each `criticality: low\|high` |
| Repo librarian | Opus · low | Builds `repo-digest.md` before fan-out (advisory; raw-file-verify rule applies) |
| Research slices | Haiku · high | Fan-out research; **high-criticality slices run `REDUNDANCY`× with independent (bottom-up vs top-down) prompts** |
| Reconciler | Opus · low | Diffs redundant slices; agreement → merge, disagreement → resolved against raw files by the synthesizer |
| Plan synthesizer | **Opus · medium** | Writes every task's **minimal-sufficiency contract** (files allowlist, acceptance criteria, out-of-scope denylist, integration note, research-already-done refs) + ADRs; decomposes aggressively |
| Impl tasks | Opus · low (Haiku · high for boilerplate-tier tasks) | Builds code against the contract |
| Contract verifier | Haiku · high | Per task, checks the diff against its contract → `met\|under\|over\|both` + specifics. **Observability only — never gates, retries, or edits.** |
| Integrator + verify | Opus · low | Reconciles tasks; runs the project's REAL test/build/lint; writes canonical file lists |
| Cleanup (6 foci) | Haiku · high | Surgical passes under strict guardrails |
| Finalizer + handoff | Opus · low | TruffleHog + keyless supply-chain trio + handoff docs + **logs contract compliance** + KPI logging |

### The quality patterns (all live in `council-workflow.js`)
1. **Planner-authored minimal-sufficiency contracts** — each task gets a contract that is a FLOOR (files allowlist, acceptance-criteria checklist, integration note) and a CEILING (out-of-scope denylist, research-already-done, hard-ceiling clause). Biggest single lever on worker cost + reliability: a low-effort worker held to a tight contract spends exactly the tokens the task requires.
2. **Redundant research on critical paths** — high-criticality slices run `REDUNDANCY` independent Haiku passes (bottom-up vs top-down); an Opus-low reconciler merges agreements and flags disagreements for the synthesizer to resolve against raw files.
3. **Contract verification (observability)** — every diff gets a Haiku check against its contract; verdicts (`under`/`over`/`both`) are surfaced in the checkpoint + handoff so the user is made aware of drift. It never blocks — the run always completes.
4. **Smaller, sharper tasks** — the synthesizer decomposes aggressively; narrow scope + a tight contract is what makes a low-effort worker reliable.

### Tuning knobs (constants at the top of `council-workflow.js`)
| Knob | Default | Raise when | Lower when |
|---|---|---|---|
| `REDUNDANCY` | 2× | Reconciler keeps finding disagreements | Slices agree >95% |
| `SAMPLE_RATE` | 0.20 | Sampled diffs fail >10% | Sampled diffs clean across 3+ runs |

The checkpoint Completion Summary logs per-run KPIs — task counts, reconciler disagreements, peer-review flag rate. The real cost benchmark is the per-agent token totals in `/workflows`.

---

## CRITICAL: Unique Workflow Identity

Every run gets its own identity so multiple councils never collide.

- **WORKFLOW_SLUG** — 2-4 word kebab-case slug from the user's request (lowercase; whitespace→`-`; strip punctuation to `a-z0-9-`; collapse/trim hyphens; cap 40 chars). E.g. `"Refactor our auth module"` → `auth-refactor`.
- **TIMESTAMP** — `date +%Y%m%d-%H%M%S`.
- **WORKFLOW_ID** — `{slug}-{timestamp}`.
- **WORKFLOW_DIR** — `~/Documents/council-docs/{WORKFLOW_ID}/` (user home Documents; project-agnostic — never write state into the current repo or under `.claude/`).

(Shares the docs folder with every `/council` run — same dir layout, different workflow id per run. Runs from before this skill was renamed from "Brandon" wrote their checkpoint as `brandon-checkpoint.md` inside this same folder — Step 1 still finds those.)

---

## Step 0: First-run status line offer (one time only)

Council spends money across three model tiers and eleven stages. The bundled
status lines make that spend visible while the run is happening. This step
offers to install them **once**, then never asks again.

**Do this before Step 1, and only if the marker file is absent.**

### 0.1 — Check the marker

```
test -f ~/.claude/canifi/statusline-choice.json && echo SKIP || echo OFFER
```

If `SKIP`, say nothing about status lines and go straight to Step 1. Do not
mention this step, do not re-offer, do not print the instructions. The
decision has already been made.

If `OFFER`, continue.

### 0.2 — Read the user's current status line

```
cat ~/.claude/settings.json 2>/dev/null | grep -A4 '"statusLine"' || echo NONE
```

Keep the result. You need it for the conflict branch in 0.4.

### 0.3 — Ask, with `AskUserQuestion`

One call, two questions:

**Question 1 — "Install the Council cost status lines?"**

| Option | Meaning |
| --- | --- |
| Council only | `statusline-council-cost.js` — live per-model spend for the running council workflow, nothing else |
| Full stack | `statusline-combined.js` — main-thread spend, council spend, and plain Agent-tool spend, stacked |
| Not now | Install nothing. Never asked again. |

Say plainly what each writes: the scripts are copied to `~/.claude/scripts/`,
and `statusLine` in `~/.claude/settings.json` is set to run one of them.

**Question 2 — only if 0.2 returned an existing `statusLine`.**

Show them the command it currently runs, verbatim, and ask:

| Option | Meaning |
| --- | --- |
| Replace it (back up first) | Copy `settings.json` to `settings.json.bak`, then overwrite `statusLine` |
| Keep mine, just copy the scripts | Files land in `~/.claude/scripts/`; print the one line to paste themselves |
| Cancel | Nothing is written |

**Never overwrite an existing `statusLine` without an explicit answer to this
question.** A status line is something people tune; silently replacing it is
not acceptable.

### 0.4 — Act on the answer

If **Not now** or **Cancel** — write the marker (0.5) and go to Step 1.

Otherwise:

1. `mkdir -p ~/.claude/scripts`
2. Copy the lib and the scripts the choice needs. They resolve each other by
   `__dirname`, so they must all land in the same directory:
   ```
   cp "${CLAUDE_PLUGIN_ROOT}/skills/council/council-cost-lib.js" ~/.claude/scripts/
   cp "${CLAUDE_PLUGIN_ROOT}/skills/council/statusline/"*.js     ~/.claude/scripts/
   ```
3. If replacing: `cp ~/.claude/settings.json ~/.claude/settings.json.bak` first,
   and tell the user the backup path.
4. Set `statusLine` in `~/.claude/settings.json`. Read the file, modify the one
   key, write it back — **preserve every other setting**. Use
   `node ~/.claude/scripts/statusline-council-cost.js` or
   `node ~/.claude/scripts/statusline-combined.js` per the choice, with
   `"type": "command"`, `"padding": 1`, `"refreshInterval": 2`.
5. If they chose "keep mine", skip 3–4 and print the exact line instead.
6. Tell them it takes effect on the next session, or immediately after
   `/config` reload.

### 0.5 — Write the marker

Always, on every path including cancel:

```
mkdir -p ~/.claude/canifi
```

Write `~/.claude/canifi/statusline-choice.json`:

```json
{
  "choice": "council | combined | scripts-only | declined",
  "installedAt": "<ISO-8601 timestamp>",
  "settingsBackup": "<path to .bak, or null>",
  "pluginVersion": "<version from plugin.json>"
}
```

The marker lives outside the plugin directory on purpose — it survives plugin
updates and reinstalls, so a user who declined once is never asked again.

If the user later wants to change their mind, they delete that file and the
offer returns on the next council run. Mention this **only** if they ask.

---

## Step 1: Determine State (read checkpoint first)

**Always start here.**

- If the user named a workflow dir, read `{WORKFLOW_DIR}/council-checkpoint.md` (or, if that's not there, the legacy `{WORKFLOW_DIR}/brandon-checkpoint.md` from a pre-rename run) directly.
- Otherwise discover the most recent: `Glob ~/Documents/council-docs/*/council-checkpoint.md` AND `~/Documents/council-docs/*/brandon-checkpoint.md` (mtime-sorted across both, take newest).
- If none found → fresh run (Step 2).

| Checkpoint `Current Phase` | Action |
|---|---|
| (no checkpoint) | Fresh run — mint identity, create dir, begin Discovery (Step 2) |
| `SPRINT0_ACTIVE` | Resume discovery |
| `SPRINT0_COMPLETE` | Launch the workflow (Step 4) |
| `SPRINT1_ACTIVE`/`SPRINT2_ACTIVE`/`SPRINT3_ACTIVE` | A workflow is (or was) running. Check `/workflows`; if it died, resume via `Workflow({scriptPath, resumeFromRunId})` using the runId saved in the checkpoint (Step 5) |
| `COMPLETE` | Finished — offer to start a new task |

---

## Step 2: Initialize a Fresh Run

1. **Mint identity** (slug + timestamp → WORKFLOW_ID, WORKFLOW_DIR).
2. **Create the dir:** `mkdir -p ~/Documents/council-docs/{WORKFLOW_ID}`.
3. **Copy the analyzer registry** so the workflow's verify can reach it:
   `cp "{PATH_TO_THIS_SKILL_DIR}/static-analysis-tools.json" "{WORKFLOW_DIR}/static-analysis-tools.json"`.
4. **Resolve the cost-engine path.** The finalizer shells out to the bundled cost engine to write the run's cost summary. Workflow scripts cannot read environment variables, so resolve it here and pass the literal absolute path as `costLib`: `echo "$CLAUDE_PLUGIN_ROOT/skills/council/council-cost-lib.js"`. If `$CLAUDE_PLUGIN_ROOT` is empty (running this skill standalone rather than from the plugin), use the absolute path to `council-cost-lib.js` sitting next to this SKILL.md. If it cannot be resolved at all, pass an empty string — the finalizer records "cost summary unavailable" as a residual risk and continues.
5. **Determine the BUILD directory** — where the work actually happens. For a change to an existing repo, that's the repo root (the session's cwd, usually). For a greenfield build, it's the target dir. You pass this as `args.buildDir` so the workflow agents know where the code is and `cd` there. (The workflow dir under Documents is for state ONLY — never the build target.)
6. **Write the initial checkpoint** to `{WORKFLOW_DIR}/council-checkpoint.md`:

```markdown
# Council Checkpoint (v5-lite tiered)

## Workflow Identity
- **Workflow ID:** {WORKFLOW_ID}
- **Workflow Dir:** ~/Documents/council-docs/{WORKFLOW_ID}/
- **Build Dir:** {absolute build dir}
- **Original Request:** [user's request verbatim]
- **Workflow Run ID:** (set when the workflow launches)
- **Architecture:** Haiku researches/reviews/cleans; Opus low plans+implements+integrates+finalizes at low effort, medium effort for plan synthesis only (tiered via agent({model, effort}))

---

## Workflow Status
- **Current Phase:** SPRINT0_ACTIVE
- **Started:** [ISO]
- **Last Updated:** [ISO]

---

## Phase 0: Discovery
### Status: in_progress
### Discovery Q&A
[populated during discovery]
### Requirements Summary
[populated when discovery completes]

---

## Phase 1: Research & Plan
### Status: pending

## Phase 2: Implementation
### Status: pending

## Phase 3: Cleanup
### Status: pending

---

## Completion Summary
[populated when the workflow finishes — includes ## KPIs and ## Escalations]
```

7. **Seed the plan + decisions files** so workflow agents have somewhere to write:
   - `{WORKFLOW_DIR}/sprint-plan.md` with `# Sprint Plan`, the Workflow ID, status `Discovery`, and a `## Original User Request` section.
   - `{WORKFLOW_DIR}/decisions.md` with an ADR-log header (the research synthesizer is the only writer; implementation + cleanup read it).
8. **Announce** the run id, that this is the *tiered* council (Haiku for cheap parallel work, Opus at low effort for everything else, Opus at medium effort for plan synthesis), and that you'll ask a few scoped questions, then everything runs autonomously.

---

## Step 3: Discovery (interactive — the only part that asks the user)

This is a conversation. **Do not spawn agents here** — the heavy, parallel work all happens later inside the workflow.

### 3a. Ground questions in the code FIRST (mandatory unless external)
Before asking anything, do a light orientation pass over the current working directory (`Glob`/`Grep`/`Read` exactly what the request implies — batch independent reads in one message). Skip ONLY for unambiguously external requests (pure third-party research, another repo, drafting docs). When in doubt, research. Append a short `## Pre-Discovery Codebase Scan` (≤20 lines) to `sprint-plan.md`.

### 3b. Ask scoped questions with AskUserQuestion
Use `AskUserQuestion`. **Up to 20 questions across at most 9 rounds — a ceiling, not a target.** Stop the moment you can write an honest requirements summary without guessing. Calibrate:
- Trivial bug fix → 3-6 questions (repro, expected vs actual, blast radius).
- Small feature → ~8-12 (goal, primary action, integration points, success criteria, out-of-scope).
- Net-new / cross-module → 12-18.
- Greenfield / major rewrite → up to 20.

Suggested coverage (drop any the code or prior answers already answer): work type & scope; goal & audience; functional requirements & integrations; technical constraints & testing expectation; success criteria & out-of-scope; risk/blast-radius/rollback/compliance; environment/ownership/validation/observability. Always finish with a **synthesis check** ("anything I got wrong or missed?").

Append each round's Q&A to `sprint-plan.md` and keep the checkpoint's Phase 0 section current.

### 3c. Write the requirements summary
When discovery is done, write a `# Phase 0 Complete: Requirements Summary` block into `sprint-plan.md` (What / Why / Who, Functional Requirements, Technical Constraints, Success Criteria, Out of Scope, Notes) and copy it into the checkpoint's Requirements Summary. Set checkpoint `Current Phase: SPRINT0_COMPLETE`, Phase 0 Status `complete`. Restate ONLY what the user confirmed — never invent constraints.

Confirm with the user: *"Requirements captured. I'll now run the tiered Research → Implementation → Cleanup autonomously in the background — Haiku does the cheap parallel work, Opus at low effort does everything else, Opus at medium effort plans, no further approvals. Ready?"* On a yes, go to Step 4.

---

## Step 4: Launch the Autonomous Workflow

This single call runs all three remaining phases. The script lives next to this skill at `council-workflow.js`. Pass the cost-engine path resolved in Step 2.4:

```
<Workflow
  scriptPath="{PATH_TO_THIS_SKILL_DIR}/council-workflow.js"
  args={{
    "workflowDir": "{ABSOLUTE_WORKFLOW_DIR}",
    "workflowId": "{WORKFLOW_ID}",
    "originalRequest": "{ORIGINAL_REQUEST_VERBATIM}",
    "requirements": "{PHASE_0_REQUIREMENTS_SUMMARY_TEXT}",
    "buildDir": "{ABSOLUTE_BUILD_DIR}",
    "costLib": "{ABSOLUTE_PATH_TO_council-cost-lib.js}"
  }}
/>
```

Notes:
- Pass `workflowDir` and `buildDir` as **absolute** paths (expand `~`). `workflowDir` holds state under Documents; `buildDir` is where the code actually changes (repo root, or the greenfield target). Pass `requirements` as the actual summary text so agents don't re-derive it (they still read `sprint-plan.md` for full detail).
- **Pass `costLib` as a literal absolute path** (Step 2.4).
- **`haikuModel`/`opusModel` are optional overrides** — omit them and `council-workflow.js` defaults to the literal Claude model IDs (Haiku / Opus) internally, which pins every agent() call to an explicit model instead of silently inheriting the session default. Only pass them explicitly if you want to override the default for a specific run. The planner uses the Opus model at **medium** effort; every other Opus call uses it at **low** effort — same model, different effort per `agent()` call. The workflow routes each agent via `agent({model, effort})`.
- The Workflow tool returns **immediately** with a runId and runs in the **background**. **Record the runId** in the checkpoint under `Workflow Run ID` and set `Current Phase: SPRINT1_ACTIVE`. Do NOT poll or sleep — you'll get a `<task-notification>` when it finishes. The user can watch live with `/workflows` (per-agent token totals there are the real cost benchmark).
- **No sentinel bookkeeping needed.** The live cost statusline auto-discovers the active run itself — every render it scans this session's `subagents/workflows/wf_*/` dirs and picks whichever has the freshest `journal.jsonl` mtime, so it always reflects reality (LIVE within 8s of activity, DONE once idle) with zero manual "mark as running/done" steps, including across process restarts/resumes.
- The script itself advances the checkpoint phase (SPRINT1→SPRINT2→SPRINT3→COMPLETE) and writes `decisions.md`, `repo-digest.md`, `engineer-handoff.md`, and `walkthrough.md` as it goes.

### What the workflow does (so you can explain it)
- **Phase 1 — Research:** an Opus-low **scout** sizes the fan-out and tags each slice `criticality`. An Opus-low **librarian** writes `repo-digest.md` (advisory map). **Haiku** research agents fan out — **high-criticality slices run `REDUNDANCY`× with independent bottom-up/top-down prompts**. An Opus-low **reconciler** diffs the duplicates: agreements merge, disagreements get flagged. An **Opus-medium synthesizer** resolves disagreements against raw files and writes a plan where every task has a **brief** (files, acceptance criteria, `file:line` exemplars, out-of-scope traps) + appends ADRs.
- **Phase 2 — Implementation:** one **Opus-low** agent per task, in dependency-aware parallel waves. Every diff gets a **Haiku** peer-review against a fixed checklist. The **Opus-low integrator** reads flagged + a `SAMPLE_RATE` random sample **in full**, the rest by summary, then runs the project's REAL test/build/lint and writes the canonical file lists (Phase 3's whitelist).
- **Phase 3 — Cleanup:** six **Haiku** cleaners do a surgical pass over ONLY the touched files under strict guardrails. An **Opus-low finalizer** re-verifies, runs TruffleHog (verified secrets BLOCK) + the keyless supply-chain trio on any touched manifests, writes `engineer-handoff.md` + `walkthrough.md`, and logs the run's **KPIs** into the checkpoint.

---

## Step 5: On Completion (or resume)

When the `<task-notification>` arrives:
1. Read the workflow's returned summary + `{WORKFLOW_DIR}/council-checkpoint.md`. Set `Current Phase: COMPLETE` if the script didn't already.
2. **Print `engineer-handoff.md` verbatim** as the final user-facing text. Do not summarize or truncate it — it's the primary deliverable surface.
3. Surface any `residualRisks` plainly, especially anything tagged BLOCKER (verified secrets / supply-chain). If `finalPassed` is false, say so honestly — do not dress a failed verify as success.
4. **Surface the KPIs** from the return value / checkpoint (`contractCompliance` / `contractViolations`, `reconcilerDisagreements`, `haikuTasks`/`opusTasks`). These tell the user whether the tiers + contracts held up and which knob to turn next run.

(The statusline flips to DONE on its own once the run goes idle — no action needed here.)

**If the workflow died mid-run** (you see SPRINT{1,2,3}_ACTIVE but no live run in `/workflows`): relaunch with `Workflow({scriptPath, resumeFromRunId: "<runId from checkpoint>"})`. Unchanged `agent()` calls return cached results instantly; only the failed/new calls re-run. Same script + same args → full cache hit.

---

## Important Reminders

1. **Read the checkpoint first** — never assume state.
2. **One interactive phase only.** Discovery asks questions; everything after is autonomous. No plan approval.
3. **The workflow is one background call.** Don't poll or sleep; wait for the notification. Record the runId for resume.
4. **Model tiering works via `agent({model, effort})`**, pinning every agent to an explicit model+effort instead of silently inheriting the session default. Haiku for cheap parallel work; Opus at low effort for everything else; Opus at medium effort for plan synthesis — same model as the workers, distinguished only by effort.
5. **Quality from structure, not per-worker intelligence.** Haiku researches (often in duplicate) and reviews; the medium-effort Opus planner plans; the low-effort Opus workers implement, integrate, and judge. The task briefs ARE the quality contract — that's why the synthesizer runs at the higher (medium) effort tier.
6. **Docs folder is the shared brain.** Agents read/write `sprint-plan.md`, `decisions.md`, `repo-digest.md`, `engineer-handoff.md`, `walkthrough.md`, `council-checkpoint.md`. `decisions.md` is written only by the synthesizer; `repo-digest.md` only by the librarian (advisory — agents verify load-bearing claims against raw files).
8. **All state lives under `~/Documents/council-docs/{WORKFLOW_ID}/`** — project-agnostic, never in the repo, never under `.claude/`.
9. **Honest reporting.** Relay the workflow's actual verify exit codes, KPIs, and residual risks. Never self-apply "verified"/"complete" without the evidence the script captured.
10. **Calibrate discovery depth to scope** — stop early when requirements are clear; the 20-question/9-round figure is a ceiling.

---

## Quick Reference: Flow

```
User: /council (or "run the council ...")
      |
      v
Read newest checkpoint (Glob) --none--> mint id + dir + checkpoint + resolve costLib
      |                                          |
      | SPRINT0_COMPLETE                          v
      |                                   DISCOVERY (interactive,
      |                                   AskUserQuestion, no agents)
      |                                          |
      |                                   write requirements,
      |                                   SPRINT0_COMPLETE
      |                                          |
      +------------------------------------------+
                       |
                       v
        Workflow(council-workflow.js, args + costLib + buildDir)  -- returns runId, runs in background --+
          Phase 1 Research  (OPUS-low scout+librarian; research[crit 2x] via HAIKU -> OPUS-medium plan)|
          Phase 2 Implement (OPUS-low briefs -> OPUS-low builds; HAIKU reviews -> OPUS-low integrate)  |
          Phase 3 Cleanup   (HAIKU surgical foci -> OPUS-low verify + TruffleHog/SCA + handoff)        |
                       |                                                                              |
                       v                                                                              |
            <task-notification> --> print engineer-handoff.md, surface KPIs, COMPLETE <--------------+
```

Paths recap:
- Workflow dir: `~/Documents/council-docs/{WORKFLOW_ID}/`  (state only)
- Build dir:    `args.buildDir`  (where code changes happen; workflow agent cwd)
- Script:       `{this skill dir}/council-workflow.js`
- Analyzer reg: copied to `{WORKFLOW_DIR}/static-analysis-tools.json` at init
- Model tiers:  `args.haikuModel` (research/review/cleanup) · `args.opusModel` (everything else, low effort; medium effort for plan synthesis) — both optional, default to the literal Claude model IDs; routed via `agent({model, effort})`
