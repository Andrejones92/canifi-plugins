export const meta = {
  name: 'council',
  description: 'Tiered Research -> Implement -> Cleanup pipeline: Haiku (high) for parallel fan-out, Opus low effort for workers+judgment, Opus medium effort for the one plan-synthesis call. The planner writes a minimal-sufficiency contract per task; a Haiku verifier checks each diff against its contract (observability only, never gates). No approval gates.',
  phases: [
    { title: 'Research', detail: 'scout scales the agent count (Opus low), then parallel Haiku research, then Opus medium synthesizes a plan with a per-task minimal-sufficiency contract' },
    { title: 'Implement', detail: 'one agent per task — Haiku for simple tasks, Opus low for the rest (parallel waves); a Haiku contract-verifier checks each diff against its contract; then Opus low integrator + verify' },
    { title: 'Cleanup', detail: 'parallel Haiku cleaners over the touched files, then Opus low finalizer verifies + handoff + logs contract compliance' },
  ],
}

// ---------------------------------------------------------------------------
// Inputs (passed via Workflow `args` by the council skill).
//   args.workflowDir     absolute path to ~/Documents/council-docs/{id}/
//   args.workflowId      the {slug}-{timestamp} id
//   args.originalRequest the user's verbatim request
//   args.requirements    the Phase 0 requirements summary text from discovery
//   args.haikuModel      model id for Haiku (research slices, cleanup foci, haiku-tier impl)
//   args.opusModel       model id for Opus  (everything else — workers at low effort,
//                        the plan-synthesizer at medium effort; same model, effort is the dial)
//   args.costLib         Absolute path to council-cost-lib.js (the finalizer shells out
//                        to it for the run cost summary). The skill resolves this from
//                        ${CLAUDE_PLUGIN_ROOT} and passes the literal path, because
//                        workflow scripts cannot read environment variables.
//
// haikuModel/opusModel both default to the literal Claude model ID below if not
// passed — this pins every agent() call to an explicit model instead of silently
// inheriting the session default. Direct Anthropic API only; no Bedrock.
// ---------------------------------------------------------------------------

const ARGS = typeof args === 'string' ? JSON.parse(args) : (args ?? {})

const DIR  = ARGS?.workflowDir
const WID  = ARGS?.workflowId      ?? 'unknown-workflow'
const REQUEST      = ARGS?.originalRequest ?? '(no original request provided)'
const REQUIREMENTS = ARGS?.requirements    ?? '(no requirements summary provided — read sprint-plan.md Phase 0)'

const HAIKU_MODEL = ARGS?.haikuModel || 'claude-haiku-4-5-20251001'
const OPUS_MODEL  = ARGS?.opusModel  || 'claude-opus-5'

if (!DIR) {
  throw new Error('council-workflow: args.workflowDir is required. Pass {workflowDir, workflowId, originalRequest, requirements, costLib}. haikuModel/opusModel are optional overrides.')
}

const PLAN         = `${DIR}/sprint-plan.md`
const CHECKPOINT   = `${DIR}/council-checkpoint.md`
const DECISIONS    = `${DIR}/decisions.md`
const HANDOFF      = `${DIR}/engineer-handoff.md`
const WALKTHROUGH  = `${DIR}/walkthrough.md`
const ANALYZER_TOOLS = `${DIR}/static-analysis-tools.json`

// ---------------------------------------------------------------------------
// OKF (Open Knowledge Format) path constants
// All OKF artifacts live under {WORKFLOW_DIR}/okf/ as navigable on-disk Markdown.
// ---------------------------------------------------------------------------
const OKF_ROOT          = `${DIR}/okf`
const OKF_INDEX         = `${OKF_ROOT}/index.md`
const OKF_REPO_DIR      = `${OKF_ROOT}/repo`
const OKF_RESEARCH_DIR  = `${OKF_ROOT}/research`
const OKF_DECISIONS_DIR = `${OKF_ROOT}/decisions`
const OKF_CONTRACTS_DIR = `${OKF_ROOT}/contracts`
const OKF_COST_DIR      = `${OKF_ROOT}/cost`
const OKF_HANDOFF_DIR   = `${OKF_ROOT}/handoff`

// Shared cost engine. Ships inside this plugin next to this file. The skill
// resolves an absolute path from ${CLAUDE_PLUGIN_ROOT} and passes it as
// args.costLib, because workflow scripts run without Node/process globals and
// cannot expand environment variables themselves.
const COST_LIB = ARGS?.costLib || 'council-cost-lib.js'

// ---------------------------------------------------------------------------
// OKF_FORMAT_GUIDE — reused across agent prompts to keep concept files consistent.
// Based on ADR-004: relative Markdown cross-links, path#Lnn evidence, ISO-8601+tz timestamps.
// ---------------------------------------------------------------------------
const OKF_FORMAT_GUIDE = `## OKF Concept File Format (Open Knowledge Format)

Every concept file is a Markdown file with a YAML frontmatter block followed by a freeform body.

### Frontmatter (required fields)
\`\`\`yaml
---
type: <research-finding | repo-area | decision | handoff-summary>
title: <short human-readable title>
description: <one-sentence summary>
tags: [<kebab-case-tag>, ...]
timestamp: <ISO-8601 with timezone, e.g. 2026-06-23T09:00:00-04:00>
# Optional fields:
resource: <canonical URL or file path this concept describes>
relates:
  - ../research/other-concept.md
  - ../decisions/adr-001-title.md
---
\`\`\`

### Body
- Cite evidence as inline \`path/to/file.js:42\` text (honesty rule: only cite lines you read).
- Use line-anchored fragment refs for load-bearing claims: \`path/to/file.js#L42\`.
- Cross-link to related OKF concepts with relative Markdown links: \`[title](../research/other.md)\`.

### Index files (index.md in each sub-directory)
Index files use the same frontmatter (type: index) and list child concepts as relative Markdown links — one per line — to enable progressive disclosure:

\`\`\`yaml
---
type: index
title: <bundle title>
description: <what this bundle covers>
tags: [...]
timestamp: <ISO-8601+tz>
---
\`\`\`

- [Concept Title](./concept-file.md) — one-line description
- [Another Concept](./another.md) — one-line description

### Root index.md (okf/index.md)
Same format; links point to sub-bundle index files:

- [Repo Bundle](./repo/index.md) — repository structure and area concepts
- [Research Bundle](./research/index.md) — research findings from all slices
- [Decisions Bundle](./decisions/index.md) — architectural decision records
- [Contracts Bundle](./contracts/index.md) — minimal-sufficiency contract per task
- [Cost Bundle](./cost/index.md) — per-model token spend + savings summary
- [Handoff Bundle](./handoff/index.md) — engineer handoff documents`

const CONTEXT_BLOCK = `## Workflow Context
- Workflow ID: ${WID}
- Workflow Dir: ${DIR}
- Plan file (source of truth): ${PLAN}
- Decisions log (ADRs): ${DECISIONS}
- Checkpoint: ${CHECKPOINT}

## Original Request
${REQUEST}

## Requirements (from discovery)
${REQUIREMENTS}

## Knowledge Graph (OKF)
The workflow maintains a navigable on-disk knowledge graph under \`${OKF_ROOT}/\`.
- Entry point: \`${OKF_INDEX}\`
- If \`${OKF_INDEX}\` exists, navigate progressively via index.md files and follow cross-links; do NOT load the whole bundle at once.
- Verify any load-bearing OKF claim against raw files (the repo bundle is advisory).
- Sub-bundles: repo (\`${OKF_REPO_DIR}/index.md\`), research (\`${OKF_RESEARCH_DIR}/index.md\`), decisions (\`${OKF_DECISIONS_DIR}/index.md\`), contracts (\`${OKF_CONTRACTS_DIR}/index.md\`), cost (\`${OKF_COST_DIR}/index.md\`), handoff (\`${OKF_HANDOFF_DIR}/index.md\`).

## Honesty rules (apply to every agent)
- Cite exact file paths and line numbers for every claim.
- If you did not open a file, do not describe its contents.
- Treat empty tool output as empty — never synthesize content to fill a gap.
- Prefer an explicit "I did not find X" over a plausible guess.
- Never claim a command passed without quoting its actual exit code / output.`

// ---------------------------------------------------------------------------
// EFFORT LADDER (locked policy — see SKILL.md)
//   Every tier runs at explicit effort. xhigh is NEVER used (wasted thinking
//   tokens). We set effort per agent() call in our OWN workflow, so
//   session-wide ultracode/xhigh never applies. Worker and Planner now run
//   the SAME model (Opus) — effort is the only dial that separates them.
//     - Haiku   (discovery/cleanup/contract-verify): 'high'
//     - Worker  (workers/scout/integrator/finalizer): 'low', flat — no
//                per-role override; the contract does the thinking, the
//                worker just executes it
//     - Planner (plan synthesis):                     'medium' — never xhigh
// ---------------------------------------------------------------------------
const EFFORT = {
  haiku:   'high',
  worker:  'low',
  planner: 'medium',
}

// Helper: build agent opts with a model id + effort for a given tier.
// tier: 'haiku' | 'worker' | 'planner'. effortOverride is still supported for
// a one-off deviation, but no call site uses it by default any more — Worker
// is flat 'low'.
function tierOpts(model, tier, effortOverride) {
  const opts = {}
  if (model) opts.model = model
  const effort = effortOverride || EFFORT[tier]
  if (effort) opts.effort = effort
  return opts
}

// Back-compat shim: existing call sites pass ...modelArg(MODEL). Keep it working
// but it no longer sets effort on its own; prefer tierOpts going forward.
function modelArg(model) {
  return model ? { model } : {}
}

// Helper: format an array as a bullet list (one item per line, prefixed with '- ')
function bulletList(items, emptyFallback = '') {
  return (items?.length ? items.map(i => `- ${i}`).join('\n') : emptyFallback) || ''
}

// ===========================================================================
// PHASE 1 — RESEARCH
//   Scout (Opus low) scales the count, Haiku fans out, Opus medium synthesizes the plan.
// ===========================================================================
phase('Research')

const SCOUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['slices', 'rationale'],
  properties: {
    rationale: { type: 'string', description: 'One sentence on why this many slices fit the request.' },
    slices: {
      type: 'array',
      minItems: 3,
      maxItems: 12,
      description: 'The research slices actually needed for THIS request — no padding, no fixed floor.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'focus', 'why'],
        properties: {
          key:   { type: 'string', description: 'short kebab-case slug, e.g. data-models' },
          focus: { type: 'string', description: 'what this research agent should investigate' },
          why:   { type: 'string', description: 'why this slice matters for the request' },
        },
      },
    },
  },
}

log('Scout (Opus, low effort): scaling research to the work that actually matters...')
const scout = await agent(
  `${CONTEXT_BLOCK}

You are the RESEARCH SCOUT. Do a quick orienting pass over the current working directory (light Glob/Grep/Read — do NOT do the deep dive yet) and read the requirements above. Then decide the research slices that are ACTUALLY needed for this specific request.

Calibrate honestly:
- A one-file bug fix may need only 3 slices (repro path, root cause, regression risk).
- A net-new feature may need 6-9 (structure, related features, data models, APIs, tests, config, edge cases...).
- A greenfield/cross-module change may need up to 12.

Do NOT pad to hit a number and do NOT collapse below what the request needs. Return the slice list.`,
  { label: 'scout', phase: 'Research', agentType: 'Explore', schema: SCOUT_SCHEMA, ...tierOpts(OPUS_MODEL, 'worker') }
)

const slices = scout?.slices ?? []
log(`Scout chose ${slices.length} research slices: ${slices.map(s => s.key).join(', ')}`)

// ---------------------------------------------------------------------------
// LIBRARIAN (serial Opus low — ADR-002, ADR-003)
// Runs between Scout and research fan-out.
// Writes: okf/repo/{key}.md (type:repo-area, one per slice), okf/repo/index.md,
//         okf/index.md (root bundle), and flat repo-digest.md for backward compat.
// ---------------------------------------------------------------------------
const LIBRARIAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['repoDigestPath', 'okfRepoIndexPath', 'concepts'],
  properties: {
    repoDigestPath:    { type: 'string', description: 'absolute path to the written repo-digest.md flat file' },
    okfRepoIndexPath:  { type: 'string', description: 'absolute path to the written okf/repo/index.md' },
    concepts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'okfPath'],
        properties: {
          key:     { type: 'string', description: 'slice key (kebab-case)' },
          okfPath: { type: 'string', description: 'absolute path to the okf/repo/{key}.md concept file' },
        },
      },
    },
  },
}

log('Librarian (Opus, low effort): mapping repo structure into OKF bundle...')
const librarian = await agent(
  `${CONTEXT_BLOCK}

${OKF_FORMAT_GUIDE}

You are the LIBRARIAN. The scout identified these research slices (JSON):
${JSON.stringify(slices, null, 2)}

## Step 1 — Create OKF directory structure
Run this exact shell command FIRST (one bash call):
\`mkdir -p ${OKF_ROOT} ${OKF_REPO_DIR} ${OKF_RESEARCH_DIR} ${OKF_DECISIONS_DIR} ${OKF_HANDOFF_DIR}\`

## Step 2 — Light repo orientation pass
Do a light-touch Glob/Read pass (do NOT duplicate the deep slice research). Read README, package.json / go.mod / Cargo.toml / pyproject.toml if present, list top-level directories, and spot-read up to 3 key entry-point files. Cite every claim with file:line — do not invent structure you have not seen.

## Step 3 — Write okf/repo/{key}.md for each slice topic
For each slice in the JSON above, write one concept file at \`${OKF_REPO_DIR}/{key}.md\` following the OKF Concept File Format above.
Use:
  type: repo-area
  title: <human readable area name>
  description: <one-sentence summary>
  tags: [<kebab-case tags relevant to the slice>]
  timestamp: <current ISO-8601 with timezone>
  relates: (cross-link to sibling repo-area concepts where relevant)

Body: describe what lives in this area of the repo, supported by file:line citations from your orientation pass. If you have no evidence for a slice, write that explicitly — do NOT fabricate structure.

## Step 4 — Write okf/repo/index.md
Write \`${OKF_REPO_DIR}/index.md\` as an OKF index (type: index) listing each concept file from Step 3 as a relative Markdown link with a one-line description:
  - [title](./key.md) — one-line description

## Step 5 — Write okf/index.md (root bundle)
Write \`${OKF_INDEX}\` as the root bundle index (type: index). List sub-bundles as relative links, noting which exist yet (research/decisions/contracts/handoff do NOT exist yet — say "not yet written"):
  - [Repo Bundle](./repo/index.md) — repository structure and area concepts
  - [Research Bundle](./research/index.md) — not yet written
  - [Decisions Bundle](./decisions/index.md) — not yet written
  - [Contracts Bundle](./contracts/index.md) — not yet written
  - [Cost Bundle](./cost/index.md) — not yet written
  - [Handoff Bundle](./handoff/index.md) — not yet written

## Step 6 — Write flat repo-digest.md (backward-compat)
Write a flat Markdown summary at \`${DIR}/repo-digest.md\` (this file is read by agents that cannot navigate OKF). Include: project overview, top-level structure, key files, patterns you observed. Cite every claim with file:line.

## Advisory note
The OKF repo bundle is advisory — downstream research agents MUST verify any load-bearing claim against the raw files. Never present repo-digest findings as ground truth without re-reading the source.

Return the structured result listing the paths you actually wrote.`,
  { label: 'librarian', phase: 'Research', agentType: 'Explore', schema: LIBRARIAN_SCHEMA, ...tierOpts(OPUS_MODEL, 'worker') }
)
log(`Librarian complete: repo-digest at ${librarian?.repoDigestPath ?? 'unknown'}, OKF repo index at ${librarian?.okfRepoIndexPath ?? 'unknown'}, ${librarian?.concepts?.length ?? 0} concept(s) written.`)

const RESEARCH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['key', 'findings', 'files', 'concerns'],
  properties: {
    key:      { type: 'string' },
    findings: { type: 'array', items: { type: 'string' }, description: 'evidence-backed findings, each citing file:line' },
    files:    { type: 'array', items: { type: 'string' }, description: 'relevant file paths discovered' },
    patterns: { type: 'array', items: { type: 'string' }, description: 'patterns to follow' },
    concerns: { type: 'array', items: { type: 'string' }, description: 'risks, gaps, "did not find X" notes' },
    okfPath:  { type: 'string', description: 'relative path to the OKF research concept this agent wrote, e.g. okf/research/{key}.md' },
  },
}

const research = (await parallel(
  slices.map(slice => () =>
    agent(
      `${CONTEXT_BLOCK}

${OKF_FORMAT_GUIDE}

You are a RESEARCH agent on slice "${slice.key}".
Focus: ${slice.focus}
Why it matters: ${slice.why}

Explore the codebase thoroughly for THIS slice only. Batch independent Read/Grep/Glob calls in single messages. Report evidence-backed findings (cite file:line), relevant files, patterns to follow, and concerns/gaps. If your slice yields thin findings, say so — do not pad.

## OKF Concept File Write (required)
After completing your research, write your findings as an OKF concept file:

1. Run this exact shell command first (defensive mkdir):
   \`mkdir -p ${OKF_RESEARCH_DIR}\`

2. Write \`${OKF_RESEARCH_DIR}/${slice.key}.md\` following the OKF Concept File Format above. Use:
   - type: research-finding
   - title: <descriptive title for the "${slice.key}" slice>
   - description: <one-sentence summary of the key finding>
   - tags: [${slice.key}, research-finding, <additional kebab-case tags>]
   - timestamp: <current ISO-8601 with timezone, e.g. 2026-06-23T09:00:00-04:00>
   - relates: cross-link to \`../repo/${slice.key}.md\` if that file exists (it was written by the librarian); cross-link to sibling research concepts where relevant

   Body: write your full findings with file:line evidence (only cite lines you actually read), patterns observed, and concerns/gaps. Cross-link related research concepts using relative Markdown links (e.g. \`[auth findings](../research/auth.md)\`). If the repo concept for this slice exists at \`${OKF_REPO_DIR}/${slice.key}.md\`, reference it with a cross-link.

3. Return \`okfPath: "okf/research/${slice.key}.md"\` in your JSON result.`,
      { label: `research:${slice.key}`, phase: 'Research', agentType: 'Explore', schema: RESEARCH_SCHEMA, ...tierOpts(HAIKU_MODEL, 'haiku') }
    )
  )
)).filter(Boolean)

log(`Research complete: ${research.length}/${slices.length} slices reported.`)

// ---------------------------------------------------------------------------
// RECONCILER (serial Opus low — ADR-002)
// Runs after all research slices complete, before synthesizer.
// Reads okf/research/{key}.md files via okfPath, detects overlapping/redundant
// findings, writes merged concepts + research index.  Never gates the run.
// ---------------------------------------------------------------------------
const RECONCILE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['reconciledPaths', 'mergedSummary'],
  properties: {
    reconciledPaths: {
      type: 'array',
      items: { type: 'string' },
      description: 'absolute paths to reconciled concept files written (may be empty if no overlaps found)',
    },
    mergedSummary: {
      type: 'string',
      description: 'brief narrative of what was merged or "no overlapping findings detected"',
    },
    disagreements: {
      type: 'array',
      items: { type: 'string' },
      description: 'any factual contradictions noted across slices',
    },
  },
}

log('Reconciler (Opus, low effort): reading research OKF concepts, merging overlaps...')
const reconciliation = await agent(
  `${CONTEXT_BLOCK}

${OKF_FORMAT_GUIDE}

You are the RECONCILER. The parallel research agents have completed and written their OKF concept files.
Here are all research results as JSON (each entry includes okfPath where the agent wrote its OKF concept):

${JSON.stringify(research, null, 2)}

## Your job
1. Before writing any files, run: \`mkdir -p ${OKF_RESEARCH_DIR}\`
   For each research result that includes an \`okfPath\`, construct the absolute path as \`${DIR}/\` + the relative okfPath value returned by each research agent (e.g. if okfPath is "okf/research/auth.md", the absolute path is \`${DIR}/okf/research/auth.md\`). Open each such file and read its YAML frontmatter and body.
2. Detect overlapping or redundant findings across slices — topics that two or more agents investigated from different angles and that could benefit from a unified view.
3. For each topic that needed merging, write a reconciled concept at \`${OKF_RESEARCH_DIR}/{slice-key}-reconciled.md\` using the OKF Concept File Format:
   - type: research-finding
   - title: Reconciled: <topic>
   - description: <one-sentence merged summary>
   - tags: [reconciled, <slice-key>, ...]
   - timestamp: <current ISO-8601 with timezone>
   - relates: cross-link to every source slice file this reconciled concept merges, e.g. \`- ../research/slice-a.md\` and \`- ../research/slice-b.md\`
   Body: synthesize the merged findings with file:line evidence retained from source concepts; note any disagreements or contradictions under a "## Disagreements" heading; cross-link back to source slice concept files.
4. Write \`${OKF_RESEARCH_DIR}/index.md\` as an OKF index (type: index) linking ALL research concepts — both the original per-slice files AND any reconciled files you produced. Format:
   - [title](./key.md) — one-line description
   (one line per file, sorted original first then reconciled)
5. If there are no overlapping findings, still write the research index linking all original slice files, and return reconciledPaths: [].

## Critical rules
- Do NOT gate the run — always proceed and return your structured result even if you wrote zero reconciled files.
- Only cite lines you actually read.
- Do not invent findings that are not present in the source files.
- Reconciled files must include cross-links back to each source slice file.`,
  { label: 'reconciler', phase: 'Research', schema: RECONCILE_SCHEMA, ...tierOpts(OPUS_MODEL, 'worker') }
)

log(`Reconciler complete: ${reconciliation?.reconciledPaths?.length ?? 0} reconciled concept(s), ${reconciliation?.disagreements?.length ?? 0} disagreement(s) noted.`)

const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['approach', 'tasks', 'filesToCreate', 'filesToModify'],
  properties: {
    approach: { type: 'string', description: 'high-level implementation strategy' },
    risks: { type: 'array', items: { type: 'string' } },
    tasks: {
      type: 'array',
      minItems: 1,
      description: 'ordered implementation tasks; independent ones will run in parallel',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'title', 'description', 'files', 'dependsOn', 'tier', 'acceptanceCriteria', 'outOfScope'],
        properties: {
          id:          { type: 'integer', description: '1-based task id' },
          title:       { type: 'string' },
          description: { type: 'string', description: 'the single outcome this task exists to produce (one-line goal), then what to do' },
          files:       { type: 'array', items: { type: 'string' }, description: 'CONTRACT — exact files allowlist: the ONLY paths this task may create or edit. Touching anything else is a contract violation.' },
          acceptanceCriteria: { type: 'array', items: { type: 'string' }, description: 'CONTRACT floor — concrete, verifiable done-conditions (a checklist). The task is complete when ALL are satisfied and NOT before. e.g. "fn X returns Y for input Z; suite T still passes".' },
          outOfScope:  { type: 'array', items: { type: 'string' }, description: 'CONTRACT ceiling — explicit denylist of things NOT to do: no adjacent refactors, no new abstractions, no out-of-allowlist renames, no dependency bumps, no doc/test scaffolding beyond the criteria, etc. Name the specific traps for THIS task.' },
          integrationNote: { type: 'string', description: 'the 1-2 seams this task must respect so parallel outputs reconcile (interface signature, shared type, call-site contract). Keep minimal — enough to prevent merge conflicts, no more.' },
          dependsOn:   { type: 'array', items: { type: 'integer' }, description: 'task ids that must finish first ([] if independent)' },
          tier:        { type: 'string', enum: ['haiku', 'opus'], description: 'haiku for pure boilerplate/config/trivial wiring; opus (default, low effort) for everything else' },
          patternRefs: { type: 'array', items: { type: 'string' }, description: 'CONTRACT — research already done (do-not-repeat): OKF concept paths and file:line refs the fan-out already established, e.g. okf/research/auth.md#L12 or src/x.js:42. The worker CITES these instead of re-exploring.' },
        },
      },
    },
    filesToCreate: { type: 'array', items: { type: 'string' } },
    filesToModify: { type: 'array', items: { type: 'string' } },
  },
}

log('Synthesizing research into an implementation plan (Opus, medium effort)...')
const plan = await agent(
  `${CONTEXT_BLOCK}

${OKF_FORMAT_GUIDE}

You are a SENIOR ARCHITECT synthesizing research into an implementation plan.

## Step 1 — Navigate the OKF knowledge graph progressively
Before reading the JSON below, walk the OKF graph to build the richest context:
1. Open \`${OKF_INDEX}\` (root bundle index). If it does not exist yet, skip to the JSON.
2. From the root index, open \`${OKF_RESEARCH_DIR}/index.md\`. For each entry, prefer the \`*-reconciled.md\` variant if one exists; otherwise open the original slice file. Do NOT load all files at once — read progressively, following cross-links only when they add material context.
3. From the root index, open \`${OKF_REPO_DIR}/index.md\` and skim the repo-area concepts (they are advisory — verify any load-bearing claim against raw source files).
4. Carry forward the OKF concept paths you relied on (e.g. \`okf/research/auth.md#L12\`) — you will cite them in task patternRefs below.

## Step 2 — Synthesize the plan from JSON + OKF context
Here are the research outputs (JSON):

${JSON.stringify(research, null, 2)}

Produce a concrete, ordered task list. Independent tasks (dependsOn: []) will be executed in parallel by the implementation phase, so make dependencies explicit and accurate. Every task names the exact files it touches.

Set tier "haiku" ONLY for tasks that are pure boilerplate generation, config file additions, trivial renaming, or copy-paste wiring with no logic decisions. Default to "opus" for everything else.

## Step 2b — Write a MINIMAL-SUFFICIENCY CONTRACT for EVERY task (this is the highest-leverage thing you do)
Workers are prompt-bound: a cheaper worker held to a tight contract outperforms a bigger worker left to roam, and it spends far fewer tokens. So for each task, the contract is a FLOOR (do all of it) and a CEILING (nothing beyond it). Every task MUST include:
- \`files\` — the EXACT allowlist of paths the task may create/edit. Keep it as narrow as the task truly needs. This is the scope boundary the verifier enforces.
- \`acceptanceCriteria\` — a concrete, verifiable checklist of done-conditions. The worker is done when ALL are met and NOT before. Make them checkable (e.g. "export fn X with signature S; existing suite T still green"), not vague ("implement X well").
- \`outOfScope\` — the explicit denylist of traps for THIS task: name the adjacent refactors, abstractions, renames, dependency bumps, doc/test scaffolding, or "while I'm here" work the worker must NOT do. Be specific to the task, not generic.
- \`integrationNote\` — the 1-2 seams (interface signature, shared type, call-site) the task must respect so parallel outputs reconcile. Minimal — enough to prevent merge conflicts, no more.
Decompose aggressively: smaller, sharper tasks with tighter contracts are what make a cheap worker reliable. A vague contract (loose allowlist, missing criteria) defeats the entire design — the worker reverts to over-exploring and gold-plating.

## Step 3 — Populate patternRefs for every task
For each task in the plan, populate \`patternRefs\` with the most relevant OKF concept paths and/or codebase file:line refs you gathered in Steps 1-2. Format:
- OKF path with optional line anchor: \`okf/research/{key}.md#L12\` or \`okf/research/{key}-reconciled.md\`
- Codebase file:line: \`src/file.js:42\`
These refs become the cross-link contract for implementation agents — they will open exactly these to orient themselves. Include 2-6 refs per task; omit refs you did not actually consult.

## Step 4 — Write ADRs (flat decisions.md + OKF decision concepts)
For every architectural decision, do BOTH of the following:

### 4a — Append flat ADR to ${DECISIONS}
Use this schema (>=2 rejected alternatives are MANDATORY per entry — if you cannot name 2 real alternatives, you did not decide anything, so do not write an ADR):

\`\`\`
## ADR-NNN: {short imperative title}
**Date:** {ISO}
**Status:** Accepted
### Context
{1-2 sentences}
### Decision
{what we chose}
### Rejected Alternatives (>=2 required)
1. **{option}** — rejected because {reason}
2. **{option}** — rejected because {reason}
### Consequences
{positive AND negative}

---
\`\`\`

### 4b — Write each ADR as an OKF decision concept
Before writing any decision concept files, run: \`mkdir -p ${OKF_DECISIONS_DIR}\`
For each ADR you write, ALSO write \`${OKF_DECISIONS_DIR}/adr-{n}-{slug}.md\` (where {n} is the zero-padded number matching ADR-NNN and {slug} is the imperative title in kebab-case). Use this frontmatter:
\`\`\`yaml
---
type: decision
title: ADR-{NNN}: {short imperative title}
description: {one-sentence summary of the decision}
tags: [decision, adr, {kebab-case-topic-tags}]
timestamp: {current ISO-8601 with timezone}
relates:
  - ../research/{most-relevant-slice}.md
---
\`\`\`
Body structure (required sections):
\`\`\`
## Context
{same 1-2 sentences as flat ADR}

## Decision
{same decision text}

## Rejected Alternatives
1. **{option}** — rejected because {reason}
2. **{option}** — rejected because {reason}

## Consequences
{positive AND negative}
\`\`\`
Cross-link to the most relevant research concept(s) using relative Markdown links in the body.

### 4c — Write ${OKF_DECISIONS_DIR}/index.md
After writing all decision concept files, write \`${OKF_DECISIONS_DIR}/index.md\` as an OKF index (type: index, title: "Decision Records") listing every adr-*.md you wrote as a relative Markdown link with a one-line description:
\`\`\`
- [ADR-NNN: {title}](./adr-{n}-{slug}.md) — one-line description
\`\`\`

### 4d — Refresh the root OKF index
After writing \`${OKF_DECISIONS_DIR}/index.md\`, update \`${OKF_INDEX}\` so the Research, Decisions, and Contracts sub-bundle entries no longer say "not yet written" but instead show the correct relative paths to their indexes. Rewrite those lines (or add them if absent) to read exactly:
\`\`\`
- [Research findings](./research/index.md) — per-slice and reconciled research concepts
- [Decision records](./decisions/index.md) — architectural decision records (ADRs)
- [Task contracts](./contracts/index.md) — the minimal-sufficiency contract for every task
\`\`\`
Preserve all other lines in \`${OKF_INDEX}\` unchanged.

## Step 4.5 — Write a COPY of every task's minimal-sufficiency contract into OKF
The contract for each task is the quality contract workers are held to; persist it as a navigable OKF concept so implementers, the contract verifier, and reviewers can read it directly.
1. Run: \`mkdir -p ${OKF_CONTRACTS_DIR}\`
2. For EACH task in the plan, write \`${OKF_CONTRACTS_DIR}/task-{id}-{slug}.md\` (where {id} is the task id and {slug} is the title in kebab-case) using this frontmatter:
\`\`\`yaml
---
type: contract
title: "Task {id} contract: {task title}"
description: {the one-line goal}
tags: [contract, task-{id}, minimal-sufficiency]
timestamp: {current ISO-8601 with timezone}
relates:
  - ../decisions/index.md
  - ../research/index.md
---
\`\`\`
Body — reproduce the task's contract VERBATIM under these exact headings (this must match the fields in the structured plan you are returning, so the copy and the live brief never diverge):
\`\`\`
## Goal
{task.description one-line goal}

## Files (allowlist — the ONLY paths this task may create/edit)
{one bullet per file in task.files}

## Acceptance criteria (floor — done when ALL satisfied, not before)
{one bullet per acceptanceCriteria item}

## Out of scope (ceiling — explicitly NOT permitted)
{one bullet per outOfScope item}

## Integration note
{task.integrationNote, or "none"}

## Research already done (do not re-explore — cite these)
{one bullet per patternRefs item, or "none"}

## Hard ceiling
Do only this. Do not gold-plate. Do not spawn extra work or subagents. Do not re-explore what research already covered. If you finish the acceptance criteria, stop and report — do not look for more to do. If the task appears under-specified or blocked, report back instead of guessing scope.
\`\`\`
3. Write \`${OKF_CONTRACTS_DIR}/index.md\` as an OKF index (type: index, title: "Task Contracts") listing every contract concept as a relative Markdown link with a one-line description:
\`\`\`
- [Task {id}: {title}](./task-{id}-{slug}.md) — {one-line goal}
\`\`\`

## Step 5 — Write plan + findings and advance checkpoint
Write the research findings + the plan into ${PLAN} under "# Phase 1: Research & Plan", and update ${CHECKPOINT}: set Current Phase to SPRINT1_COMPLETE then SPRINT2_ACTIVE, Phase 1 Status to complete. Return the structured plan.`,
  { label: 'synthesize-plan', phase: 'Research', schema: PLAN_SCHEMA, ...tierOpts(OPUS_MODEL, 'planner') }
)

const tasks = plan?.tasks ?? []
log(`Plan ready: ${tasks.length} implementation task(s).`)

// ===========================================================================
// PHASE 2 — IMPLEMENT
//   Haiku for haiku-tier tasks, Opus low for the rest (parallel waves).
//   Opus low integrator reconciles + verifies.
// ===========================================================================
phase('Implement')

const IMPL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['taskId', 'status', 'filesTouched', 'summary'],
  properties: {
    taskId:       { type: 'integer' },
    status:       { type: 'string', enum: ['done', 'partial', 'blocked'] },
    filesTouched: { type: 'array', items: { type: 'string' } },
    summary:      { type: 'string', description: 'what was implemented' },
    followups:    { type: 'array', items: { type: 'string' }, description: 'out-of-scope items discovered; do not silently expand scope' },
    verification: { type: 'string', description: 'exact command output if anything was run, else "not verified"' },
  },
}

function implPrompt(task) {
  const dependsOn = task.dependsOn ?? []
  const deps = dependsOn.length ? `Depends on tasks: ${dependsOn.join(', ')} (their work is already applied to the tree).` : 'No prerequisites.'
  const researchDone = task.patternRefs?.length
    ? `\n## Research already done (do NOT re-explore — cite these, don't re-derive)\n${bulletList(task.patternRefs)}\n`
    : ''
  const integrationNote = task.integrationNote
    ? `\n## Integration note (the seam you must respect)\n${task.integrationNote}\n`
    : ''
  return `${CONTEXT_BLOCK}

You are an IMPLEMENTATION agent. Read the full plan in ${PLAN} for shared context. decisions.md is READ-ONLY for you — reference ADRs by number, never append.

## Your Task #${task.id}: ${task.title}
${task.description}

## ═══ MINIMAL-SUFFICIENCY CONTRACT ═══
This contract is a FLOOR (do all of it) AND a CEILING (nothing beyond it). A separate verifier checks your diff against it. Spend exactly the tokens the task requires — neither under- nor over-working.

### Exact files (allowlist — the ONLY paths you may create or edit)
${bulletList(task.files, '- (infer from the plan — but stay minimal)')}
Touching any file NOT on this list is a contract violation. If a needed file is missing from the list, STOP and report it in followups — do not expand scope.

### Acceptance criteria (the floor — done when ALL are satisfied, and NOT before)
${bulletList(task.acceptanceCriteria, '- (satisfy the task description exactly)')}

### Out of scope (the ceiling — explicitly do NOT do these)
${bulletList(task.outOfScope, '- no refactors, abstractions, renames, dep bumps, or docs/tests beyond the criteria')}
${integrationNote}${researchDone}
### HARD CEILING (verbatim — obey exactly)
Do only this. Do not gold-plate. Do not spawn extra work or subagents. Do not re-explore what research already covered. If you finish the acceptance criteria, STOP and report — do not look for more to do. If the task appears under-specified or blocked, report back instead of guessing scope.

## ${deps}

## OKF Knowledge Graph (read-only)
The research and decision knowledge graph is available under \`${OKF_ROOT}/\`. Navigate it progressively via \`${OKF_INDEX}\` → \`${OKF_RESEARCH_DIR}/index.md\` and \`${OKF_DECISIONS_DIR}/index.md\` for architectural context. Read-only: do NOT write any OKF files. Verify any load-bearing claims from OKF concepts against the raw source files.

## Discipline
- Prefer Edit over Write; do not rewrite files wholesale.
- Touch only files on the allowlist. If you find a needed out-of-scope change, report it in followups — do not silently expand scope.
- Minimize new dependencies. If a task genuinely requires adding a package to a manifest/lockfile, prefer a well-established, actively-maintained package and flag the addition in followups so the finalizer can scan it. Block on anything that looks malware-class (typosquat, install-script abuse, network/shell access during install, eval, unmaintained + known CVE); when in doubt, report it rather than install.
- No placeholder code, no TODOs — implement fully.
- Never craft a bypass for a blocked safety check; surface it instead.

Return your structured result.`
}

const completedTasks = new Map()
function runTask(task) {
  const isHaiku = task.tier === 'haiku'
  const implModel = isHaiku ? HAIKU_MODEL : OPUS_MODEL
  // Haiku-tier tasks run at 'high'; Opus workers run flat 'low' (the
  // contract does the thinking, the worker implements). See EFFORT ladder.
  const implTier = isHaiku ? 'haiku' : 'worker'
  return agent(implPrompt(task), {
    label: `impl:#${task.id}-${(task.title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24)}`,
    phase: 'Implement',
    schema: IMPL_SCHEMA,
    ...tierOpts(implModel, implTier),
  }).then(res => { completedTasks.set(task.id, res); return res })
}

const implResults = []
const remaining = [...tasks]
while (remaining.length) {
  let ready = remaining.filter(task => {
    const deps = task.dependsOn ?? []
    return deps.every(d => completedTasks.has(d))
  })
  if (!ready.length) {
    log(`WARN: ${remaining.length} task(s) have unsatisfiable deps; running them in one wave.`)
    ready = remaining.slice()
  }
  const wave = await parallel(ready.map(task => () => runTask(task)))
  implResults.push(...wave.filter(Boolean))
  for (const task of ready) remaining.splice(remaining.indexOf(task), 1)
}

const touched = [...new Set(implResults.flatMap(result => result?.filesTouched ?? []))]
const haikuCount = tasks.filter(task => task.tier === 'haiku').length
const opusCount  = tasks.filter(task => task.tier !== 'haiku').length
log(`Implementation complete: ${implResults.length} task(s) — ${haikuCount} haiku, ${opusCount} opus; ${touched.length} file(s) touched.`)

// ===========================================================================
// CONTRACT VERIFIER (Haiku, observability-only — does NOT gate the run)
//   One Haiku agent per completed task checks the worker's result against the
//   minimal-sufficiency contract the planner wrote: floor met (acceptance
//   criteria + only-allowlisted-files) and ceiling respected (nothing on the
//   denylist, no scope creep / gold-plating). It NEVER blocks, retries, or
//   edits — the workflow completes regardless. Violations are aggregated and
//   surfaced in the final return + checkpoint so the user is made aware.
// ===========================================================================
const CONTRACT_VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['taskId', 'verdict', 'reason'],
  properties: {
    taskId:  { type: 'integer' },
    verdict: { type: 'string', enum: ['met', 'under', 'over', 'both'], description: 'met = floor+ceiling satisfied; under = an acceptance criterion unmet; over = did something out-of-scope / touched a non-allowlisted file / gold-plated; both = under AND over' },
    reason:  { type: 'string', description: 'one or two sentences citing the SPECIFIC criterion missed and/or the specific out-of-scope thing done (name the file/change). "contract met" if verdict is met.' },
    offendingFiles: { type: 'array', items: { type: 'string' }, description: 'any files touched that were NOT on the allowlist (empty if none)' },
    unmetCriteria:  { type: 'array', items: { type: 'string' }, description: 'acceptance-criteria items not satisfied (empty if none)' },
  },
}

function contractVerifyPrompt(task, result) {
  return `${CONTEXT_BLOCK}

You are a CONTRACT VERIFIER. You do NOT fix, edit, or run anything. You read one implementation task's contract and its worker's reported result, and judge — strictly — whether the worker did EXACTLY what the contract required: nothing more, nothing less. Report your verdict; the workflow proceeds regardless of what you find.

A canonical copy of every task's contract is also persisted under \`${OKF_CONTRACTS_DIR}/\` (navigate via \`${OKF_CONTRACTS_DIR}/index.md\`); the contract for this task is reproduced verbatim below, so you do not need to open it, but it is there for cross-reference.

## The contract the planner wrote for Task #${task.id}: ${task.title}
Goal: ${task.description}

### Allowlist (the ONLY files this task was permitted to create/edit)
${bulletList(task.files, '- (none specified)')}

### Acceptance criteria (the floor — ALL must be satisfied)
${bulletList(task.acceptanceCriteria, '- (none specified)')}

### Out of scope (the ceiling — none of these were permitted)
${bulletList(task.outOfScope, '- (none specified)')}

## What the worker reported
- status: ${result?.status ?? 'unknown'}
- filesTouched: ${JSON.stringify(result?.filesTouched ?? [])}
- summary: ${result?.summary ?? '(none)'}
- followups: ${JSON.stringify(result?.followups ?? [])}

## Your job
Open the touched files and confirm against the raw source (do not trust the worker's self-report alone; cite file:line for anything load-bearing). Then decide:
- **under** — one or more acceptance criteria are NOT satisfied. List them in unmetCriteria.
- **over** — the worker touched a file NOT on the allowlist, OR did something on the out-of-scope denylist, OR gold-plated beyond the criteria. List non-allowlisted files in offendingFiles and describe the overreach in reason.
- **both** — under AND over.
- **met** — floor fully satisfied and ceiling fully respected.
Be strict and specific: name the exact criterion or the exact out-of-scope change. Do NOT edit anything. Return the structured verdict.`
}

log('Contract verifier (Haiku): checking each task against its minimal-sufficiency contract (observability only — does not gate)...')
const contractVerdicts = (await parallel(
  implResults.map(result => {
    const task = tasks.find(t => t.id === result?.taskId)
    if (!task) return null
    return () => agent(contractVerifyPrompt(task, result), {
      label: `contract:#${task.id}`,
      phase: 'Implement',
      schema: CONTRACT_VERDICT_SCHEMA,
      ...tierOpts(HAIKU_MODEL, 'haiku'),
    })
  }).filter(Boolean)
)).filter(Boolean)

const contractViolations = contractVerdicts.filter(v => v && v.verdict !== 'met')
log(`Contract verifier complete: ${contractVerdicts.length} checked, ${contractViolations.length} violation(s) — ${contractViolations.map(v => `#${v.taskId}:${v.verdict}`).join(', ') || 'all met'}. (Run continues regardless.)`)

const INTEGRATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['allPassed', 'files', 'verification'],
  properties: {
    allPassed: { type: 'boolean' },
    files: { type: 'array', items: { type: 'string' }, description: 'final canonical list of created+modified files' },
    verification: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['command', 'exitCode'],
        properties: {
          command:  { type: 'string' },
          exitCode: { type: 'integer' },
          tail:     { type: 'string' },
        },
      },
    },
    notes: { type: 'string' },
  },
}

log('Integrating and verifying (Opus, low effort)...')
const integration = await agent(
  `${CONTEXT_BLOCK}

You are the INTEGRATOR. The implementation agents produced these results (JSON):

${JSON.stringify(implResults, null, 2)}

Note: \`${OKF_RESEARCH_DIR}/\` and \`${OKF_DECISIONS_DIR}/\` are available as a navigable OKF knowledge graph (navigate via \`${OKF_INDEX}\`) for additional context when reconciling tasks — read-only, no OKF writes.

1. Reconcile any conflicts or gaps between tasks so the pieces work together.
2. Detect the project's REAL tooling (read package.json / Makefile / pyproject.toml / Cargo.toml / go.mod — do NOT assume npm). Prefer the project's own scripts; otherwise consult ${ANALYZER_TOOLS} (per-language analyzer registry: match file extensions to its \`languages\` map, use each entry's \`detect\` then \`check\`). Run the available test, build, and lint commands. Capture each command's exact exit code and output tail. Never fabricate a pass; if a tool is unavailable, record exitCode -1 with "tool not available".
3. Write the canonical "Files Created" / "Files Modified" lists and a Phase 2 summary into ${PLAN} under "# Phase 2: Implementation". These exact paths become Sprint3's whitelist.
4. Update ${CHECKPOINT}: set Current Phase to SPRINT2_COMPLETE then SPRINT3_ACTIVE, Phase 2 Status to complete, and record validation results.

allPassed is true ONLY if every verification command exited 0. Return the structured result.`,
  { label: 'integrate-verify', phase: 'Implement', schema: INTEGRATE_SCHEMA, ...tierOpts(OPUS_MODEL, 'worker') }
)

const finalFiles = integration?.files?.length ? integration.files : touched
log(`Integration ${integration?.allPassed ? 'PASSED' : 'reported issues'}; whitelist = ${finalFiles.length} file(s).`)

// ===========================================================================
// PHASE 3 — CLEANUP
//   Haiku surgical passes (parallel), Opus low finalizer verifies + writes handoff.
// ===========================================================================
phase('Cleanup')

const GUARDRAILS = `## Hard Scope (whitelist — the ONLY files you may edit)
${bulletList(finalFiles, '- (none — report no-op)')}

## Guardrails (non-negotiable)
- Scope lock: touch only whitelisted files.
- API lock: no changes to exported names, signatures, or types — internal renames only.
- Test lock: do NOT add, remove, skip, or weaken tests.
- Behavior lock: no algorithm changes, no semantic changes — collapse and tighten only.
- No new dependencies. No new files (unless extracting a helper strictly inside the whitelist).
- No silent edits: every deletion/rename appears in your diff summary.
- No bypass-crafting: if a safety check blocks you, stop and report.`

const CLEAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['focus', 'changes'],
  properties: {
    focus: { type: 'string' },
    changes: {
      type: 'array',
      description: 'one entry per edit; empty array means "no changes" (a valid outcome)',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['file', 'lines', 'reason'],
        properties: {
          file:   { type: 'string' },
          lines:  { type: 'string' },
          before: { type: 'string' },
          after:  { type: 'string' },
          reason: { type: 'string' },
        },
      },
    },
  },
}

const CLEAN_FOCI = [
  { key: 'dedupe',       focus: 'Dedupe & collapse near-duplicate helpers, repeated literals, copy-pasted blocks (only when the extraction clearly reads better).' },
  { key: 'deadcode',     focus: 'Remove dead code: unreachable branches, unused imports, commented-out blocks, non-public unused exports.' },
  { key: 'naming',       focus: 'Improve naming of locals, private helpers, internal types ONLY. Never rename anything exported.' },
  { key: 'types',        focus: 'Tighten types: narrow any/unknown, sharpen generics, precise shapes. Preserve every exported signature.' },
  { key: 'indirection',  focus: 'Inline single-use wrappers and trivial factories. Leave abstractions that earn their cost.' },
  { key: 'flow',         focus: 'Strip stale comments, resolved TODOs, noisy logs; simplify nested conditionals while preserving behavior.' },
]

const cleanResults = (await parallel(
  CLEAN_FOCI.map(cleanFocus => () =>
    agent(
      `${CONTEXT_BLOCK}

You are a CLEANUP agent. Read the plan in ${PLAN} for context. This is a SURGICAL pass over freshly-written code — not a rewrite. Note: \`${OKF_INDEX}\` is available for context (read-only; cleanup writes NO OKF files and stays within the whitelist).

## Your focus: ${cleanFocus.focus}

${GUARDRAILS}

Report a precise diff summary: file, line range, before, after, one-sentence reason. If you changed nothing, return changes: [] — that is valid.`,
      { label: `cleanup:${cleanFocus.key}`, phase: 'Cleanup', schema: CLEAN_SCHEMA, ...tierOpts(HAIKU_MODEL, 'haiku') }
    )
  )
)).filter(Boolean)

const totalEdits = cleanResults.reduce((sum, result) => {
  const changeCount = result?.changes?.length ?? 0
  return sum + changeCount
}, 0)
log(`Cleanup complete: ${totalEdits} edit(s) across ${cleanResults.length} foci. Verifying + writing handoff (Opus, low effort)...`)

const FINAL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verification', 'allPassed', 'residualRisks'],
  properties: {
    allPassed: { type: 'boolean' },
    verification: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['command', 'exitCode'],
        properties: {
          command:  { type: 'string' },
          exitCode: { type: 'integer' },
          tail:     { type: 'string' },
        },
      },
    },
    residualRisks:    { type: 'array', items: { type: 'string' } },
    okfHandoffPath:   { type: 'string', description: 'relative path to okf/handoff/index.md' },
  },
}

const finalize = await agent(
  `${CONTEXT_BLOCK}

You are the CLEANUP VERIFIER + HANDOFF WRITER. The cleanup agents produced these diff summaries (JSON):

${JSON.stringify(cleanResults, null, 2)}

Whitelist (touched files):
${bulletList(finalFiles, '- (none)')}

Contract-verifier verdicts (Haiku, observability only — these did NOT gate the run; surface them, do not act on them):
${JSON.stringify(contractVerdicts, null, 2)}

Do all of the following:
1. Re-run the project's real typecheck/lint/test/build commands (detect tooling — do NOT assume npm). Read ${ANALYZER_TOOLS} for the per-language static-analyzer registry: match the whitelist files' extensions to its \`languages\` map, prefer each language's \`primary\` tool (fall back to its \`polyglot\` Semgrep entry), and use the registry's \`detect\` command to check availability before running its \`check\` command. If a project config / build file exists (package.json, Makefile, pyproject.toml, Cargo.toml, go.mod), prefer the project's own scripts over the registry defaults. If NO build/test/lint tooling exists for the touched files, record that plainly (exitCode -1, "no applicable tooling") — do not fabricate a pass. Capture exact exit codes and output tails. If any fails, make the MINIMAL revert within the whitelist to restore green; three strikes on the same failure -> stop and record it as a residual risk (do NOT bypass).
2. Run TruffleHog over the whitelist files for secrets. Invoke it as \`trufflehog filesystem <path1> <path2> ... --only-verified --json\` — pass the whitelist files (or their parent dir) as POSITIONAL arguments. Do NOT rely on \`--paths-from-file\` (it does not exist in current TruffleHog versions, e.g. 3.95.x, and errors with "unknown long flag"); \`--no-update\` is optional and may be omitted if unsupported. First run \`trufflehog --version\`; if TruffleHog is not installed, record that as a residual risk (scan not performed) rather than claiming a clean scan. VERIFIED secrets are a BLOCK — record them as a residual risk flagged BLOCKER and do not claim success. Redact any echoed credential as first6...last4.
3. If the whitelist contains package manifests/lockfiles, run the keyless supply-chain scanners over the added/changed dependencies (npq for pre-install vetting, GuardDog for malware heuristics, OSV-Scanner for known vulnerabilities — whichever are available; detect each before running). Malware-class findings (typosquat, install-script abuse, eval, network/shell access during install) and critical/high known vulnerabilities are residual-risk BLOCKERs. If none of these scanners are available, record that plainly as a residual risk (scan not performed) rather than claiming a clean scan.
4. Write ${HANDOFF} (engineer-facing: What Changed / Why / Architecture Decisions / PR-Review Questions / Residual Risks) and ${WALKTHROUGH} (author-facing narrative, <=600 words, drawn only from sprint-plan.md + decisions.md + engineer-handoff.md).
5. Write the OKF handoff bundle (dual-write — the flat files from step 4 are KEPT alongside this):
   a. Run: mkdir -p ${OKF_HANDOFF_DIR}
   b. Write ${OKF_HANDOFF_DIR}/what-changed.md — frontmatter type: handoff-summary, title: "What Changed", description: one-sentence summary of the changes, tags: [handoff-summary, what-changed], timestamp: current ISO-8601+tz, relates: [../decisions/index.md, ../research/index.md]; body: synthesized from the ${HANDOFF} content you just wrote (What Changed / Why / Architecture Decisions / PR-Review Questions sections).
   c. Write ${OKF_HANDOFF_DIR}/risks.md — frontmatter type: handoff-summary, title: "Residual Risks", description: "Risks and open items after cleanup", tags: [handoff-summary, residual-risks], timestamp: current ISO-8601+tz; body: bullet list of every residualRisk you are about to return, one per line.
   d. Write ${OKF_HANDOFF_DIR}/walkthrough.md — frontmatter type: handoff-summary, title: "Author Walkthrough", description: "Author-facing narrative walkthrough of what was built", tags: [handoff-summary, walkthrough], timestamp: current ISO-8601+tz, relates: [./what-changed.md]; body: the same <=600-word narrative from ${WALKTHROUGH} (do NOT load the flat file after writing it — use the content you composed in step 4).
   e. Write ${OKF_HANDOFF_DIR}/index.md — frontmatter type: index, title: "Handoff Bundle", description: "OKF handoff bundle for this workflow run", tags: [handoff, index], timestamp: current ISO-8601+tz; body: relative Markdown links to the three concept files above: \`- [What Changed](./what-changed.md) — summary of all changes made\`, \`- [Residual Risks](./risks.md) — open risks and blockers\`, \`- [Author Walkthrough](./walkthrough.md) — narrative walkthrough of the implementation\`.
   f. Return okfHandoffPath: 'okf/handoff/index.md' in the JSON result. If any OKF file write fails, record the failure as a residual risk (do NOT block allPassed on OKF write failures alone).
5.5. Write the OKF COST SUMMARY (exact numbers from the shared cost engine — do NOT hand-sum tokens yourself; you cannot see your own usage and an LLM tally will drift):
   a. Find this run's transcript dir with no sentinel/lookup file needed. The \`CLAUDE_CODE_SESSION_ID\` env var (set in every bash call) is this session's id; the session dir is the one directory under \`~/.claude/projects/*/\` whose name equals that id. This run's transcript dir is whichever \`subagents/workflows/wf_*/\` under that session dir has the freshest \`journal.jsonl\` mtime (there is at most one live run per session — this IS that run, since you are its finalizer). Resolve it with one bash command:
      \`SESSDIR=$(find "$HOME/.claude/projects" -maxdepth 2 -type d -name "$CLAUDE_CODE_SESSION_ID" 2>/dev/null | head -1); RUNDIR=$(ls -dt "$SESSDIR"/subagents/workflows/wf_*/ 2>/dev/null | head -1); echo "$RUNDIR"\`
      (\`ls -dt\` sorts directories by their own mtime, which is touched whenever a file inside them — like \`journal.jsonl\` — is written, so the most recently active run sorts first.)
   b. Run the shared cost engine on it: \`node ${COST_LIB} "$RUNDIR"\`. It prints JSON: { ok, agentFiles, agentsDone, perModel:{<model>:{tokens:{in,out,cr,cw5,cw1}, cost}}, grandTokens, blendedTotal, opusOnly, fableOnly, savedVsOpusPct, savedVsFablePct }. Use these numbers VERBATIM — they are the same figures the live statusline shows. If the command fails or returns ok:false, record "cost summary unavailable (cost engine could not read the run transcripts)" as a residual risk and skip the rest of this step (do NOT fabricate numbers, do NOT block allPassed).
   c. Run: \`mkdir -p ${OKF_COST_DIR}\`. Write \`${OKF_COST_DIR}/summary.md\` with frontmatter: type: cost-summary, title: "Run Cost Summary", description: one-line total (e.g. "$X.XX across N agents; ~P% under an Opus-only run"), tags: [cost-summary, tokens, spend], timestamp: current ISO-8601+tz, relates: [../decisions/index.md, ../handoff/index.md]. Body — reproduce the engine's numbers exactly:
      - A "## Blended total" line: the blendedTotal in dollars, plus agentsDone/agentFiles.
      - A "## Per-model breakdown" markdown table with columns: model | input | output | cache-read | cache-write(5m) | cache-write(1h) | cost($). One row per model in perModel, plus a TOTAL row (sum of grandTokens + blendedTotal).
      - A "## Cache hit rate" line: compute \`totalInputLike = grandTokens.in + grandTokens.cr + grandTokens.cw5 + grandTokens.cw1\` and \`cacheHitRatePct = totalInputLike > 0 ? (grandTokens.cr / totalInputLike) * 100 : null\`. Write "{cacheHitRatePct.toFixed(0)}% of input-like tokens served from cache" (or "Cache hit rate unavailable (no input-like tokens recorded)" if null) — same formula the live statuslines use, so this number never diverges from what was shown during the run.
      - A "## Savings vs single-model" section: "vs Opus-only: \${opusOnly} → {savedVsOpusPct}% saved" and "vs Fable-only: \${fableOnly} → {savedVsFablePct}% saved".
      - A "## Caveat" line, verbatim: "The savings figures re-price THIS run's exact token counts as if a single model handled everything. A real Opus-only or Fable-only run would emit different token counts (the newer tokenizer produces ~30% more tokens for the same text, and turn counts differ), so this is a same-tokens estimate, not a literal counterfactual."
   d. Write \`${OKF_COST_DIR}/index.md\` (type: index, title: "Cost", tags: [cost, index], timestamp) with one link: \`- [Run Cost Summary](./summary.md) — per-model token spend, blended total, and savings vs a single-model run\`.
   e. Also append a compact "## Cost" section to the ${CHECKPOINT} Completion Summary: blended total, per-model dollar split, the two savings percentages, and the cache hit rate. If the cost engine was unavailable, write "Cost summary unavailable" there instead.
6. Append a "# Phase 3: Cleanup Summary" to ${PLAN} with the consolidated changelog and verification results, and update ${CHECKPOINT}: Current Phase SPRINT3_COMPLETE then COMPLETE, Phase 3 Status complete.
7. In the ${CHECKPOINT} Completion Summary, add a "## Contract Compliance" section listing EVERY contract-verifier verdict that is NOT "met" (task id, verdict under/over/both, and the specific reason/offending files/unmet criteria). If all tasks met their contract, write "All tasks met their minimal-sufficiency contract." Also mention any non-met verdicts in ${HANDOFF} under Residual Risks / PR-Review Questions so the reviewer sees them. These are observability signals — they do NOT affect allPassed.

allPassed is true ONLY if every verification command exited 0 AND no verified secrets / supply-chain blockers were found (contract verdicts do NOT affect allPassed). Return the structured result.`,
  { label: 'finalize-verify-handoff', phase: 'Cleanup', schema: FINAL_SCHEMA, ...tierOpts(OPUS_MODEL, 'worker') }
)

return {
  workflowId: WID,
  researchSlices: slices.length,
  tasks: tasks.length,
  haikuTasks: haikuCount,
  opusTasks: opusCount,
  filesTouched: finalFiles,
  implementationPassed: integration?.allPassed ?? false,
  cleanupEdits: totalEdits,
  finalPassed: finalize?.allPassed ?? false,
  residualRisks: finalize?.residualRisks ?? [],
  contractVerdicts,
  contractViolations,
  contractCompliance: contractViolations.length === 0
    ? 'all tasks met their minimal-sufficiency contract'
    : `${contractViolations.length} of ${contractVerdicts.length} task(s) broke contract: ${contractViolations.map(v => `#${v.taskId} (${v.verdict}) — ${v.reason}`).join(' | ')}`,
  artifacts: { plan: PLAN, decisions: DECISIONS, handoff: HANDOFF, walkthrough: WALKTHROUGH, checkpoint: CHECKPOINT },
  okfBundles: {
    index:     OKF_INDEX,
    repo:      `${OKF_REPO_DIR}/index.md`,
    research:  `${OKF_RESEARCH_DIR}/index.md`,
    decisions: `${OKF_DECISIONS_DIR}/index.md`,
    contracts: `${OKF_CONTRACTS_DIR}/index.md`,
    cost:      `${OKF_COST_DIR}/index.md`,
    handoff:   finalize?.okfHandoffPath ? `${OKF_HANDOFF_DIR}/index.md` : null,
  },
}
