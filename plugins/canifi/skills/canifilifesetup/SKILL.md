---
name: canifilifesetup
description: >-
  Interactive setup wizard that interviews the user (AskUserQuestion-driven) about what they want a personal AI research/second-brain system to actually do for them, then GENERATES a complete custom set of skill files under ~/.claude/skills/. The brain's mandatory core is a Google Open Knowledge Format (OKF v0.1) markdown library — plain markdown + YAML frontmatter, built for fast agent lookup, conformant to the real published spec, readable by any OKF-aware tool. Every other output (HTML dashboard, audio podcast, PDF, slideshow) is independently opt-in and generated FROM that OKF document. Also optionally generates a sequential research queue and a completion-signal delivery skill. Generalizes the Canifi LifeOS second-brain system to any user's own goals and taste — never clones one specific person's dashboard design. Use when the user says "canifilifesetup", "/canifilifesetup", "build me a second brain", "set up my research system", "build my life OS", or references this skill.
version: 1.0.0
---

# canifilifesetup — interview-driven generator for a personal second-brain system

You are running an interactive interview, then generating REAL skill files.
The output is not a design doc — it is a working set of `SKILL.md` files
under `~/.claude/skills/` implementing a personal research/second-brain
system tailored to THIS user's goals, life, and taste.

**This is the sibling of `canifidevsetup`**, same discipline, different
domain: that skill generates a dev-team orchestration system; this one
generates a personal research/memory system. Read `canifidevsetup/SKILL.md`
if you want the fuller articulation of the interview/confirmation-gate/
honesty discipline this mirrors — it is not required reading to run this
skill, but useful if something here is under-specified.

**The bundled `reference/mechanics.md` is the fixed authority. Read it in
full before Phase 6** — it's the proven-working technical patterns to
mirror: parallel-agent dispatch, the OKF library structure and frontmatter
schema (the mandatory core), fast agent lookup over that library,
disk-checkpointed queueing, completion-signal delivery per channel, the
four optional output formats, and the model/effort choice.

**Critical distinction — do not blur this:** the mechanics are fixed, and
the OKF library is the one mandatory output. Everything else — visual
identity, category taxonomy, what the personal-anchor file actually
contains, agent count, delivery channel, which optional formats exist,
repo naming — is the user's own design, produced fresh through the
interview below. Never copy another person's specific dashboard styling,
BRAIN_CORE content, or repo name into a generated file. If you don't have
a concrete answer from THIS user for a design-level choice, ask — don't
default to an example you've seen elsewhere.

## Interview discipline

- Ask via `AskUserQuestion`. Open-ended questions use a free-text-friendly
  format (broad framings plus "Other" — the user's typed answer is the
  real payload). Batch independent questions into single calls (up to 4).
- **Adapt the question tree** to Phase 1's answers. Someone researching
  purely for work topics shouldn't be asked about health protocols; someone
  who explicitly wants a health/fitness brain should get that depth.
  Nothing on the Phase 2-4 coverage list is optional to COVER, but how you
  ask it should fit their stated context.
- Record answers in a running scratch summary (in conversation, not a
  file) — Phase 5 replays it for confirmation.
- Chase vague answers to concrete values before Phase 6. A generated file
  with `<your-repo-here>` in it is a failure — go back and ask.

---

## Phase 0 — Preflight

1. Confirm the reference file exists:
   `ls ${CLAUDE_PLUGIN_ROOT}/skills/canifilifesetup/reference/`. If missing, tell the
   user plainly and stop — there is no other legitimate source for the
   mechanics authority.
2. Check for prior runs: any existing skill with a `generated-by:
   canifilifesetup` frontmatter line? If found, ask update/regenerate vs.
   abort; back up each file to `<file>.bak.<epoch>` before overwriting,
   never silently.
3. **Collision check beyond this wizard's own prior runs**: before Phase 6
   writes anything, check whether the proposed skill names already exist
   as UNRELATED skills (no `generated-by` marker) — this has happened for
   real (a machine can already have its own hand-built `dashboard` or
   `brain-retrieval` skill unrelated to this wizard). If so, do not
   overwrite silently; either propose a distinct name-prefix for the
   generated skills or get explicit confirmation to replace the existing
   one, backed up first.
4. Confirm `git` is installed. `gh` only matters if the interview lands on
   GitHub as the store (Phase 4) — note if missing, don't block yet.
   `osascript`/Messages.app only matter if iMessage is chosen as the
   delivery channel (Phase 2/4) — confirm macOS before generating that
   path; never generate an iMessage step for a non-Mac environment.
5. **Detect an existing director.** Check
   `ls ~/.claude/skills/director/SKILL.md`. If present, don't ask about it
   yet — just note it for Phase 3, and read
   `~/.claude/skills/director/scripts/spawn-issue-fixer.sh` /
   `teardown-issue-fixer.sh` (and `spawn-team.sh`/`teardown-team.sh`) now
   so their real, already-personalized idioms are on hand when Phase 3's
   question comes up.

## Phase 1 — Open-ended discovery (always first, always free-form)

Ask genuinely open questions and read the answers carefully — they shape
everything after:

1. **"What do you actually want this system to do for you?"** (stay current
   in a field, make better health/training decisions, research before big
   purchases or decisions, learn a new domain deeply, general curiosity —
   something else entirely?)
2. **"Six months from now this is working perfectly — what does a normal
   week with it look like? What are you doing, what is it doing?"**
3. **"How do you actually want to consume research — reading raw notes,
   a visual dashboard, a notification when something's ready, audio while
   driving/training, something else?"**

Summarize back in 2-4 sentences, let them correct you before narrowing.
Everything in Phases 2-4 filters through these answers.

## Phase 2 — Design scope (wide open, per the user's explicit choice)

Cover, adapted to Phase 1:

- **The OKF library is mandatory and not itself a design choice** — every
  run always produces a conformant markdown concept document
  (`reference/mechanics.md` has the full spec). State this plainly rather
  than asking about it; the interview time goes to what's actually
  optional below.
- **Optional output formats.** Ask about all four independently — HTML
  dashboard, audio podcast (local Kokoro TTS), PDF, slideshow
  (`reference/mechanics.md` has the complete list — there are no others).
  A user can pick none of them and still get a real, fast-lookup brain. For
  each one they want, verify the local toolchain actually exists before
  committing to it (Phase 4) — don't generate a format the machine can't
  produce. If audio is chosen, also ask which Kokoro voice they want
  (`reference/mechanics.md` has the voice list) — this is a real taste
  question, never default to one voice silently.
- **Visual identity — only relevant if HTML/slideshow was chosen.** Never
  suggest cloning a named existing product's look. Ask concretely: light
  or dark by default (or both), a rough personality (dense/technical vs.
  clean/minimal vs. something else in their own words), any
  color/typography preferences. Show 2-3 named DIRECTIONS as prompts to
  react to, not finished designs to pick from.
- **What the personal-anchor file should actually contain.** It is
  non-negotiable that one exists (it's itself an OKF concept document,
  `type: Personal Anchor`) and gets read first by everything, but its
  CONTENT is entirely this user's: identity basics always; then only the
  sections Phase 1 made relevant (health/training protocols, current
  projects, active tools/stack, travel, personal rules/constraints for the
  research itself — e.g. "never recommend anything requiring a
  subscription"). Elicit real starter content conversationally here rather
  than leaving a blank template.
- **Categories / focus areas.** What domains will get researched? Informs
  the library's directory taxonomy.
- **Delivery channel for the completion signal** — a real "it's done"
  signal when a run finishes: iMessage (Mac + Messages.app), email, Slack
  webhook, a local system notification, or "just the repo, I'll check it
  myself." Confirm platform feasibility before committing to a channel.
- **Agent count per research run.** Fully the user's choice — ask directly
  how many parallel research agents should work each topic. Regardless of
  count, confirm they want the personalization agent slot reserved
  (`mechanics.md`) — warn once if they want to cut it, then honor an
  explicit choice to cut it.
- **Output-format selection mode.** Independent of WHICH optional formats
  exist at all (above): should the research skill ask which formats to
  produce every time, always produce every opted-in format automatically,
  or use one or more named default presets (their own names/combinations,
  e.g. `quick` = OKF only, `full` = everything) with ad hoc override
  always available regardless of mode? `reference/mechanics.md` has the
  full pattern — if they want presets, get the actual names and format
  lists now, don't leave them to define later.

## Phase 3 — Which skills actually get generated

**If Phase 0 detected an existing director, ask about integration FIRST —
it changes how everything below gets generated and invoked.** Explain
plainly: running as standing skills (today's default) means this system's
sessions/processes exist independently of the director; running as a
director-integrated on-demand team means the director spawns a single
session only when research is actually requested and tears it down after
— zero standing footprint, no risk of contending with whatever else the
director has running. Recommend integration if a director exists; it's
never wrong to decline.

If they want integration, ask one more thing: **on-demand-only** (mirrors
`spawn-issue-fixer.sh`/`teardown-issue-fixer.sh` — spawned only when the
user asks for research, torn down after; recommended, since research is
user-initiated, not a continuous monitoring rotation) vs. **full
round-robin rotation** (mirrors `spawn-team.sh`/`teardown-team.sh` — joins
the lap cadence and activates every lap whether or not anything was
asked for). Tell them plainly what round-robin means before they pick it;
default the recommendation to on-demand-only.

Either integration choice means Phase 6 will patch the real
`director/SKILL.md` (backed up first) and add matching spawn/teardown
scripts to `director/scripts/` — surface this explicitly in Phase 5, it's
not implied by just picking "yes, integrate."

Always generated:
- The research skill (N parallel agents → OKF concept document in the
  library → whichever optional formats were chosen → completion signal).
- The retrieval skill (fast frontmatter-first lookup over the OKF library).

Ask, don't assume:
- **Sequential queue skill** — only if they want to batch multiple topics
  unattended (e.g. overnight). Skip if they only ever want to run one
  topic at a time interactively.
- **Delivery skill** — only if Phase 2 chose a channel beyond "just the
  repo." Generate the real mechanism for whatever channel they picked.
- **HTML export** — only if Phase 2 opted in.
- **Audio export** — only if Phase 2 opted in and Kokoro (or an equivalent
  local TTS) is verified available.
- **PDF export** — only if Phase 2 opted in and a headless Chrome/Chromium
  binary is verified available.
- **Slideshow export** — only if Phase 2 opted in. Defaults to a
  self-contained HTML deck (no toolchain dependency); only generates a
  `.pptx`-style export if the user explicitly wants one AND a local
  toolchain for it is verified available.

## Phase 4 — Concrete specifics (real strings, no placeholders)

Every answer here gets baked literally into generated files:

- **The library location.** GitHub (ask username + repo name + local
  clone path) or local-only (ask the local path, drop all push steps
  honestly). Offer to `git init` a fresh repo or `gh repo clone` an
  existing one.
- **Display name** — what should generated files call them.
- **Delivery specifics** — phone number (iMessage), email address, webhook
  URL, whatever the chosen channel needs. Confirm the channel actually
  works in THIS environment before finalizing (e.g. `osascript -e 'tell
  application "Messages" to get name'` for iMessage).
- **Output-format toolchain verification — actually run it, don't just
  check for it.** For each opt-in format chosen in Phase 2, do the real
  verification from `reference/mechanics.md` before Phase 5's confirmation
  gate: for audio, install the Kokoro venv + download both model files if
  not already present (or confirm they're already there); for PDF, locate
  a real Chrome/Chromium binary AND run a throwaway print against a
  trivial HTML file to confirm it actually produces a PDF; for a `.pptx`
  slideshow variant, `python3 -c "import pptx"` and install
  `python-pptx` if missing. Report what's missing and offer to skip that
  format or install the dependency now — don't carry a format into
  Phase 5 on a hope that it'll work later.
- **Model & effort.** Ask directly: Opus low effort, or Opus medium
  effort (see `reference/mechanics.md` — these are the only two choices).
  This is a single pick that applies to the generated skills' agent
  dispatch; it is independent of the agent-count choice from Phase 2.
- **Skill naming.** Confirm the exact folder names for every skill about
  to be generated (post-collision-check from Phase 0).
- **Director-integration specifics (only if Phase 3 opted in).** The
  exact session name for the spawned team (following the existing
  director's naming convention — read its current roster in
  `director/SKILL.md` for the pattern), and the exact roster
  row/on-demand-gate wording that will be added.

## Phase 5 — Confirmation gate (nothing is written before this)

Present one consolidated summary via `AskUserQuestion` before ANY file
write, `mkdir`, or `git` command:

1. The list of skills to be generated (name, one-line purpose, new vs.
   overwrite-with-backup).
2. The library location and structure (repo or local path, personal-anchor
   concept's real section list, root `index.md`/`log.md`).
3. Design choices restated: which optional formats exist, output-format
   selection mode (ask-every-time / always-all / named presets, with the
   preset table if any), visual identity direction (if any format needs
   one), agent count, delivery channel, model/effort choice.
4. A one-line reminder that the OKF library is generated regardless of
   which optional formats were picked — it is not itself optional.
5. **If director-integration was chosen**: the EXACT addition to
   `director/SKILL.md` (roster row or on-demand-gate section, shown in
   full) and the new `spawn-canifilife.sh`/`teardown-canifilife.sh` file
   names — called out as its own item, not folded silently into item 1's
   list.

Offer: proceed / edit something (loop back) / abort. Re-confirm if
anything material changes after this gate.

## Phase 6 — Generation

Write the files below. Every generated `SKILL.md` gets frontmatter with
`name`, `description`, `version: 1.0.0`, and `generated-by:
canifilifesetup` (so a future re-run's Phase 0 can find it). Mirror
`reference/mechanics.md`'s mechanisms exactly; fill in this user's real
design choices from Phases 2-4 everywhere else. No placeholder strings.

1. **Research skill** — topic decomposition into the user's chosen agent
   count (with the personalization slot unless explicitly cut), parallel
   dispatch via the Agent tool at the chosen model/effort, compiled
   findings written as a conformant OKF concept document in the library
   (frontmatter + cited body + cross-links), THEN each chosen optional
   format built from that document per the configured output-format
   selection mode (ask-every-time / always-all / named presets — include
   the actual preset table if any), then the completion signal via
   whichever delivery skill exists (or none).
2. **Retrieval skill** — personal-anchor-concept-first, then frontmatter/
   tag query, then link-walk, then body read, per `mechanics.md`;
   exact/partial/no-match handling; fires the completion signal here too
   if a delivery channel exists.
3. **Queue skill** (if chosen) — disk-checkpointed, resumable, sequential
   across topics, parallel within each topic, PENDING/IN_PROGRESS/
   COMPLETED state per `mechanics.md`.
4. **Delivery skill** (if chosen) — the real mechanism for the chosen
   channel only; never generate a channel that can't run in this
   environment.
5. **HTML export** (if chosen) — self-contained dashboard built from the
   OKF document, in the user's own visual identity.
6. **Audio export** (if chosen) — local Kokoro TTS pattern per
   `mechanics.md`, reading the OKF document (and HTML export if it also
   exists), never raw research state.
7. **PDF export** (if chosen) — headless-browser print per `mechanics.md`
   — of the HTML export if one exists, otherwise of a minimal internal
   render of the OKF document's body.
8. **Slideshow export** (if chosen) — a self-contained HTML deck (or
   `.pptx` only if explicitly requested and verified feasible) per
   `mechanics.md`, synthesized from the OKF document's body.
9. **The personal-anchor concept document** in the library, with real
   elicited content from Phase 2, not a blank template.
10. **Root `index.md` / `log.md`** (and per-category `index.md` as
    categories emerge) per the OKF structure in `mechanics.md` — both are
    themselves valid OKF documents with `type` frontmatter, not a bespoke
    scheme.
11. **Director integration** (if chosen) — back up `director/SKILL.md`,
    add the confirmed roster row or on-demand-gate section, add
    `director/scripts/spawn-canifilife.sh` and `teardown-canifilife.sh`
    mirroring the real local `spawn-issue-fixer.sh`/`teardown-issue-fixer.sh`
    (or `spawn-team.sh`/`teardown-team.sh` for the round-robin variant)
    idioms exactly — group-aware `session_exists()`, `set -euo pipefail`,
    `chmod +x`.

After writing: syntax-check anything executable, re-read each generated
`SKILL.md` against the Phase 5 summary, and `grep -ril` across generated
files for any leftover placeholder token or another person's specific
naming that shouldn't be there.

## Phase 7 — Handoff

1. Print the exact file list written (absolute paths).
2. State plainly what's unverified: you have not watched a full research
   run complete. Say what you checked (files written, syntax-checked,
   paths consistent with the confirmed design) — not that it "works."
3. Note any manual step still needed (Messages.app sign-in, GitHub repo
   creation/push, `gh auth login`, filling in any personal-anchor section
   left thin).
4. Ask ONE explicit yes/no: do they want to run their first research topic
   now? Only on explicit yes, actually invoke the generated skill.

## Honesty discipline

- Never claim the generated system "works" beyond what you've actually
  verified.
- If an interview answer makes a mechanic inapplicable (no git, no macOS
  for iMessage, no local compute for TTS), say so and adapt or drop that
  piece — don't generate machinery that can't run.
- If a request would erode the mandatory OKF library itself (e.g. "skip
  the frontmatter", "don't bother with a real `type` field") or another
  fixed mechanic in `reference/mechanics.md` (e.g. skipping the
  personalization agent slot, or an HTML artifact that isn't actually
  self-contained), name the tradeoff once — for the OKF library
  specifically, be direct that this breaks spec-conformance and the fast-
  lookup guarantee, not just a style preference — then honor an explicit
  choice to proceed anyway and note the deviation in the generated skill
  so a future session knows it was deliberate, not an oversight.
