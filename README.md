# canifi

Contract-bound agent workflows for [Claude Code](https://claude.com/claude-code).

Three skills in one plugin:

| Skill | What it does |
| --- | --- |
| `/canifi:council` | Takes a request from discovery to delivery on its own — research, implementation, cleanup — with no approval gates. Every worker is bound to a minimal-sufficiency contract. |
| `/canifi:canifidevsetup` | Interviews you about your projects, then generates a complete director + team orchestration system as real skill files. |
| `/canifi:canifilifesetup` | Interviews you about how you learn, then generates a personal research and second-brain system built on an OKF markdown library. |

## Install

```
/plugin marketplace add Andrejones92/canifi-plugins
/plugin install canifi
```

Then `/reload-plugins`, and all three are available in any project.

## Council

The idea is that **quality comes from structure, not from per-worker intelligence**.

Before any worker starts, the planner writes it a *minimal-sufficiency contract* — which is both a floor and a ceiling:

**Floor — do all of this**
- `files allowlist` — the exact files this task may touch
- `acceptance criteria` — a checklist the diff has to satisfy
- `integration note` — how this task meets the ones around it

**Ceiling — and nothing beyond it**
- `out-of-scope denylist` — explicitly what not to touch
- `research-already-done` — findings handed over so nobody re-investigates
- `hard-ceiling clause` — a stated limit on how far the task may go

That is what makes a cheap, low-effort worker reliable, and what makes a long unsupervised run safe.

### The run

One interactive discovery pass, then it goes. After discovery there are no approval gates.

| Stage | Tier | What happens |
| --- | --- | --- |
| Discovery | session default | Interactive. The one place you are asked anything. |
| Scout | Opus · low | Sizes the work into 3–12 slices, tags criticality |
| Repo librarian | Opus · low | Builds a repo digest before anything fans out |
| Research slices | Haiku · high | Parallel research; high-criticality slices run twice, bottom-up and top-down |
| Reconciler | Opus · low | Merges agreement, escalates disagreement |
| Plan synthesizer | Opus · medium | The one expensive call. Writes every task contract and the ADRs |
| Impl tasks | Opus · low | Builds against the contract |
| Contract verifier | Haiku · high | Checks each diff: `met` / `under` / `over` / `both`. Never gates |
| Integrator | Opus · low | Reconciles tasks, runs the project's real test/build/lint |
| Cleanup | Haiku · high | Six surgical passes under guardrails |
| Finalizer | Opus · low | Secret scan, supply-chain checks, handoff docs, cost summary |

Effort is the only dial separating the planner from the workers — they run the same model.

The contract verifier is **observability only**. It records drift and surfaces it in the handoff; it never blocks, retries, or edits, so the run always completes.

State is written to `~/Documents/council-docs/{workflow-id}/` — never into your repo.

### Cost status lines

Council ships live cost readouts. **The first time you run it**, it offers to install them
and then never asks again:

| Choice | What you get |
| --- | --- |
| Council only | Live per-model spend for the running council workflow |
| Full stack | Main-thread spend, council spend, and Agent-tool spend, stacked |
| Not now | Nothing installed. Asked again next run |
| Never ask again | Nothing installed, and never raised again |

The scripts are copied to `~/.claude/scripts/` and `statusLine` is set in your
`~/.claude/settings.json`. If you already have a status line configured, Council shows you
what it is, backs the file up to `settings.json.bak`, and only replaces it if you say so —
or copies the scripts and leaves your config alone if you'd rather wire it yourself.

The decision is only recorded once you actually decide — an install, or "never ask again".
A "not now" writes nothing, so you get the offer again next time rather than losing it.

The record lives at `~/.claude/canifi/statusline-choice.json`, outside the plugin, so it
survives updates and reinstalls. Delete that file to be asked again.

## canifidevsetup

Generates a round-robin director that spawns a team's sessions on demand, runs them, and tears them down. It does not hand you someone else's rotations — it asks what you actually run (one repo or five platforms, findings-only QA or real feature development) and writes real `SKILL.md` files with your repo names and paths baked in.

Non-negotiables it carries forward, learned the hard way:

- **On-demand spawn/teardown** — a team's sessions exist only while that team is active
- **ACK-before-act** — every directive is acknowledged before the recipient starts
- **No detached background processes** — watchers run as pane children, with an orphan sweep on teardown
- **Read before you watch** — a watcher only detects change from baseline, so read the target first

## canifilifesetup

Generates a personal research system whose core is a [Google Open Knowledge Format](https://github.com/google/open-knowledge-format) markdown library — plain markdown plus YAML frontmatter, built for fast agent lookup. Every other output (HTML dashboard, podcast, PDF, slides) is independently opt-in and generated *from* that document.

## Requirements

- Claude Code with plugin support
- `/canifi:council` uses the Workflow tool and Node for its cost engine
- The setup skills generate tmux-based orchestration, so they assume tmux for the systems they produce

## Development

```
claude --plugin-dir ./plugins/canifi
claude plugin validate ./plugins/canifi
```

## Licence

MIT — see [LICENSE](LICENSE).
