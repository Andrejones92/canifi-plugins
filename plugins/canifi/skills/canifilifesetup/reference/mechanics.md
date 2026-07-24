# The mechanics authority — working technical patterns to mirror

These are proven-working technical idioms, not personal/branding decisions.
Generated skills should mirror the MECHANISM here exactly (it works, it's
been run for real); the content around it (prompts, copy, visual identity)
comes from the interview, never from this file.

**The single non-negotiable output is an OKF-conformant markdown concept
document, per run, in the brain repo.** Every other artifact type (HTML,
audio, PDF, slideshow) is optional and is generated FROM that document —
never the other way around. A user who wants none of the optional formats
still gets a real, fast-lookup brain; they just don't get the extras.

## 10-parallel-agent research dispatch

- Decompose the topic into N distinct, non-overlapping research angles
  (N = the user's chosen agent count, default 10 unless they say otherwise).
- **Reserve one slot for personalization**: an agent whose job is to read
  the personal-anchor file (`BRAIN_CORE.md`-equivalent) and produce
  findings/recommendations specifically through that lens, flagging any
  conflicts with the user's actual situation — do not cut this slot to fit
  a smaller agent count; shrink elsewhere first.
- Present the N-way breakdown to the user as a table before launching —
  get confirmation or let them adjust angles.
- Launch all N in parallel via the Agent tool with `run_in_background: true`.
  Each agent prompt must be **fully self-contained** (the agent has no
  conversation context) and, for angles that benefit from it, include the
  relevant personal-anchor slice **verbatim**, not summarized.
- As agents complete, track progress; once all are done, compile findings
  into the OKF concept document (the synthesis/write step below) before
  touching any optional export.

## OKF library (the mandatory core of the brain)

The brain repo IS an [Open Knowledge Format](https://cloud.google.com/blog/products/data-analytics/how-the-open-knowledge-format-can-improve-data-sharing)
(OKF v0.1) bundle — a vendor-neutral, plain-markdown-plus-YAML-frontmatter
spec designed for fast agent lookup, not a bespoke schema this system
invented. Conforming to the real spec (rather than a look-alike) is what
makes the brain readable by any OKF-aware tool later, not just this
system's own skills.

**Bundle layout** — file paths ARE concept identities:

```
{brain-repo}/
├── index.md                  # root index — reserved filename
├── log.md                    # chronological change history — reserved filename
├── BRAIN_CORE.md             # the personal-anchor concept (this system's own convention, still valid OKF: has a `type` field)
└── {category}/
    ├── index.md               # optional per-category index
    └── {topic-slug}.md        # one concept document per research run
```

**Frontmatter schema (YAML) — every concept document requires this:**

```yaml
---
type: [REQUIRED — e.g. "Research Note", "Personal Anchor", "Index"]
title: [human-readable title]
description: [one-line summary]
resource: [URL to an optional companion artifact — the HTML/PDF/slideshow export, if one exists]
tags: [array of tags for filtering/discovery]
timestamp: [ISO 8601, e.g. 2026-07-24T14:30:00Z]
---
```

`type` is the ONLY required field. Everything else is standard-but-optional
per the spec — include it whenever you have a real value, never fabricate
a placeholder to fill the field.

**Body** — free-form markdown: structured findings, tables, evidence,
citations. Cross-reference related concepts with standard relative
markdown links (`[customers](/tables/customers.md)` style) — this is what
builds the graph an agent walks, not the directory hierarchy alone.

**Reserved files:**
- `index.md` (root and per-category, optional but generate them) — itself
  a valid OKF document (`type: Index`), body is a catalog table of the
  concepts beneath it plus links to each.
- `log.md` — chronological, most-recent-first record of changes (`type:
  Log`), replaces any bespoke changelog scheme — this IS the changelog,
  spec-conformant.

**Commit and push after every run** (or local-only, per the user's Phase 4
answer — drop the push step honestly if there's no remote):
`git add -A && git commit -m "..." && git push`.

## Fast agent lookup pattern (how retrieval actually uses OKF)

This is the payoff of conforming to the real spec — mirror the reference
workflow exactly:

1. **Query frontmatter first** — filter by `type`/`tags` across concept
   documents without parsing any markdown body. This is the fast path;
   never open every file to find one.
2. **Follow links** — walk the markdown cross-references from a matched
   concept to related ones the graph, not just the directory tree.
3. **Read the body** — only once frontmatter + links have narrowed to the
   actual candidate(s), read the full markdown for rich context/citations.
4. Read the personal-anchor concept (`BRAIN_CORE.md`) first, always, in
   any retrieval session — it filters relevance for everything else.
5. On exact match: answer directly, cite the concept document (and its
   `resource` link if a companion export exists).
6. On partial match: say so explicitly, offer to expand into a new run.
7. On no match: say so explicitly, offer to research it.
8. If a completion-signal delivery channel exists, use it here too, not
   just on fresh research runs.

## Disk-checkpointed sequential queue (only if the user wants multi-topic batching)

- State lives on disk under a dedicated directory, one subfolder per
  topic-slug, so a queue survives context compaction or a new session.
- Modes: start (fresh topic list) / resume (scan disk for in-progress,
  continue) / status (report all queues) / abort.
- Strictly sequential across topics — each topic still runs its N agents
  in parallel internally. The queue is the outer loop, not a way to run
  multiple topics' agent pools concurrently (that reintroduces the exact
  resource-contention problem the on-demand tmux design elsewhere in this
  system exists to avoid).
- Mark PENDING → IN_PROGRESS → COMPLETED per topic as it's processed;
  handle a failed topic by marking it and continuing, not aborting the
  whole queue.

## Completion-signal delivery (channel depends on interview answer)

**iMessage (macOS + Messages.app only — verify platform before generating this):**
```bash
osascript -e 'tell application "Messages" to send "{message}" to buddy "{phone}" of (1st account whose service type = iMessage)'
```
Multi-message sends: separate `osascript` calls, ~1s pause between. If it
fails, check `osascript -e 'tell application "Messages" to get name'` first
and direct the user to sign in / grant Automation permission
(System Settings → Privacy & Security → Automation) rather than retrying
blind.

**Any other channel the interview surfaces** (email, Slack webhook, a
local notification, nothing beyond the repo) — implement the real
mechanism for that channel; never generate an iMessage step for a non-Mac
user or fabricate a channel that can't actually run in their environment.
Say so plainly in Phase 4 if a requested channel isn't feasible and let
them pick a working alternative.

## Model & effort tier

Every generated skill's agent dispatch (research agents and, if separate,
the synthesis/write step) pins an explicit model and effort — never omit
`--model`/effort and let it silently inherit whatever the terminal last
used. Only two choices exist, both Opus:

| Choice | Model | Effort |
| --- | --- | --- |
| A | `opus` | `low` |
| B | `opus` | `medium` |

Ask the user which they want (Phase 4) — it's a direct choice, not
inferred from anything else. The research agent count (how many parallel
agents run per topic) is a fully separate, user-chosen number (Phase 2) —
do not conflate agent count with model/effort tier.

## Director integration (on-demand team pattern, only if a director exists)

If `~/.claude/skills/director/SKILL.md` already exists on the machine, an
on-demand orchestrator is already running the show — don't stand up a
second, independent standing-session system next to it. That's exactly
the resource-contention problem the director's on-demand model exists to
prevent (see the director's own "why the on-demand model exists" section).
Offer to integrate instead.

**Mirror the REAL local scripts, not a bundled guess.** The user's own
director already has its own personalized session-naming, model, and
group-aware-tmux conventions baked into
`~/.claude/skills/director/scripts/spawn-team.sh` /
`teardown-team.sh` (multi-session team pattern) and
`spawn-issue-fixer.sh` / `teardown-issue-fixer.sh` (single-session,
on-demand pattern, no Principals). Read whichever pair is relevant in full
before generating anything — these are the authoritative idiom for THIS
user's director, more authoritative than anything in this file.

**Two integration shapes:**

- **On-demand-only (recommended default)** — mirrors the issue-fixer
  pattern: one session, spawned only when the user explicitly asks for
  research, runs the requested topic(s), tears down when done. Never part
  of the automatic round-robin lap cadence. This fits how research
  actually gets triggered (user-initiated, not continuous monitoring like
  a QA rotation) and keeps the steady-state footprint at zero extra
  sessions.
- **Round-robin rotation** — mirrors the full team pattern: joins the
  strict lap cadence like the other rotations, activated every lap whether
  or not the user asked for anything that lap. Only generate this if the
  user explicitly confirms they want it after being told plainly what it
  means (a lap runs unattended research, or a no-op cycle, every rotation
  — not just on request).

**This means patching `director/SKILL.md` itself** — a real file this
wizard doesn't own. Never do this silently:
- Back it up (`director/SKILL.md.bak.<epoch>`) before writing, same
  discipline as any other collision in Phase 0.
- Show the exact addition (new roster row, or new on-demand-gate section
  mirroring the issue-fixer gate's shape) in Phase 5's confirmation gate
  before writing it.
- Generate the matching `spawn-canifilife.sh` / `teardown-canifilife.sh`
  (or whatever name the user's roster naming convention implies) in
  `director/scripts/`, group-aware `session_exists()` copied exactly from
  the real local script, `set -euo pipefail`, `chmod +x`, `bash -n` after
  writing.

**If no director exists, or the user declines integration**: generate the
standalone skills as normal — user-invoked directly, no spawn/teardown
lifecycle to manage.

## Output-format selection modes

Independent of which optional formats exist at all (the previous
section), the research skill needs to know WHICH of the opted-in formats
to actually produce on a given run. Three modes, user's choice (Phase 2):

1. **Ask every time** — the research skill prompts for which formats
   (from the opted-in set) before generating, every run.
2. **Always all** — every opted-in format is produced automatically, no
   prompt, every run.
3. **Named default(s)** — the user defines one or more named presets (e.g.
   `quick` → OKF only, `full` → every opted-in format, `deck` → OKF +
   slideshow — their own names and combinations), and picks which preset
   applies when they don't specify one at request time. Store presets as a
   simple table in the generated research skill's own `SKILL.md` (name →
   format list); no separate config file needed unless the user wants to
   edit presets without touching the skill file.

**Regardless of mode, an explicit ad hoc request always wins** — "just
get me the PDF this time" or "give me everything on this one" overrides
whatever the configured default/mode is for that single run. The mode
only governs what happens when the request doesn't specify.

## The optional output formats — this is the complete list

The OKF concept document (above) is the only mandatory output. These four
are each independently opt-in per the Phase 2 interview, and each is
generated FROM the finished OKF document's content — never a second
independent research pass, so nothing can drift out of sync with the
brain. Do not add other output formats.

### 1. HTML dashboard (opt-in)

- Single file, zero external dependencies — all CSS/JS/fonts inlined.
  Must open offline, in any browser, indefinitely (no CDN links that can
  rot).
- Built from the OKF document's body — same findings, visual treatment
  layered on top. One visually distinct callout for the single most
  important finding.
- If generated, set the OKF document's `resource` field to its path so
  retrieval can offer it alongside the text answer.

### 2. Audio podcast (opt-in)

**Verified working recipe (tested, not guessed) — mirror this exactly,
don't reinvent a different pipeline:**

TTS engine: **Kokoro-82M via `kokoro-onnx`** — local, free, no network
call at synthesis time, ~6x realtime on Apple Silicon.

```bash
# One-time environment setup — a dedicated venv, not the system Python
which ffmpeg || brew install ffmpeg
VENV=~/.claude/skills/{generated-skill-name}/.venv
[ -f "$VENV/bin/python3" ] || python3 -m venv "$VENV"
$VENV/bin/pip install kokoro-onnx onnxruntime soundfile numpy pydub mutagen

# One-time model download (~340MB total)
MODELS=~/.claude/skills/{generated-skill-name}/models
mkdir -p "$MODELS"
[ -f "$MODELS/kokoro-v1.0.onnx" ] || curl -fL -o "$MODELS/kokoro-v1.0.onnx" \
  https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx
[ -f "$MODELS/voices-v1.0.bin" ] || curl -fL -o "$MODELS/voices-v1.0.bin" \
  https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin
```

- Split the script on sentence boundaries, group into ~80-word chunks,
  synthesize each chunk, concatenate with ~200ms silence between chunks
  for natural pacing. Output is 24kHz mono WAV per chunk; `ffmpeg`
  resamples/encodes the concatenated result to 44.1kHz MP3 (128kbps CBR
  mono is a reasonable default, ~1MB/minute).
- Voice is a Phase 2 interview question, not an inherited default — list
  Kokoro's built-in voices (e.g. `af_bella`, `af_sky`, `bf_emma`,
  `am_michael`, `am_eric`, `am_adam`, `bm_george` — check the installed
  `voices-v1.0.bin` for the current full list) and let the user pick.
  Never silently carry over any one voice as "the" default — this is
  taste, not mechanism.
- If a chunk fails, fail loudly (non-zero exit) — no silent fallback to a
  different engine or a truncated episode.
- Reads the OKF document's body (using the HTML dashboard as an additional
  source if one was also generated) to write the spoken script, synthesizes
  speech, commits the audio file alongside the source document, sets/
  appends the OKF `resource` field, and regenerates any feed index the
  user wants (e.g. RSS).
- Before generating this skill, actually run the install/download steps
  above (or confirm they're already done — check for the venv and both
  model files) so the skill is real and working the moment it's
  generated, not "should work." If `brew`/`curl`/enough disk space isn't
  available, say so plainly and offer to skip audio.

### 3. PDF (opt-in)

**Verified working recipe — tested on this exact command:**

```bash
"<chrome-binary>" --headless --disable-gpu --print-to-pdf="{path}.pdf" "{path}.html"
```

- A rendering pass, not new content generation, so it always matches the
  source 1:1. If an HTML dashboard was also generated, print that. If no
  HTML dashboard exists, render a minimal styled HTML wrapper of the OKF
  document's markdown body first (internal intermediate only, not exposed
  as a separate export), then print that the same way.
- Binary resolution, in order: `google-chrome` / `chromium` /
  `chromium-browser` on `$PATH`; on macOS also check
  `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` and
  `/Applications/Chromium.app/Contents/MacOS/Chromium`.
- Works as shown on macOS without `--no-sandbox`. On Linux, particularly
  running as root (CI/containers), Chrome refuses to launch without
  `--no-sandbox` — add it there; it's unnecessary noise on a normal
  developer machine, so don't add it unconditionally.
- Before generating this skill, actually locate a working binary on the
  target machine (`command -v` / `ls` the app bundle path) and run a
  throwaway print against a trivial HTML file to confirm it produces a
  real PDF, not just check the binary exists. If none is found, say so
  plainly and either skip the PDF path or ask if the user wants to install
  Chrome/Chromium first — never fabricate a converter that isn't there.
- Commit alongside the source document; set/append its `resource` field.

### 4. Slideshow (opt-in)

- A self-contained HTML artifact in a slide-deck layout by default — same
  self-contained-output rule as the dashboard (all CSS/JS inlined, opens
  offline, arrow-key + click navigation). Synthesized from the OKF
  document's body — condense to slide-appropriate density: one core idea
  per slide, not the body's prose reflowed. No external toolchain needed
  for this default form — it's just generated markup.
- Only generate a portable `.pptx` export if the user explicitly asks for
  one. This needs `python-pptx`, which is **not installed by default** —
  verify with `python3 -c "import pptx"` before promising it; if missing,
  either install it now (`pip3 install python-pptx`, confirm the import
  succeeds afterward) or say plainly it isn't available yet and offer the
  HTML deck instead. Never generate `.pptx`-writing code against an
  unverified/absent library.
- Commit alongside the source document; set/append its `resource` field.
