---
name: cross-platform-testing
description: Process for coordinating independent Claude Code sessions (running in separate tmux sessions, each driving a different platform — e.g. iOS app in a simulator vs. a web app in a browser) through a real end-to-end interaction test. Supports a two-session peer-to-peer mode AND a three-session orchestrated mode where a Lead Staff Engineer session authors the plan and governs two Principal Staff Engineer sessions. Use when the user asks for a "cross-platform test", "cross-platform interaction test", a "Lead"-orchestrated run, wants sessions to test owner/hero (or any two-role) flows against each other, or references this skill by name. Covers the shared-folder file protocol, the Lead plan-distribution + ACK guarantee, tmux session discovery/nudging, background watcher patterns, round/role structure, and the no-fake-writes verification discipline.
version: 2.0.0
---

# Cross-Platform Testing

Two independent Claude Code sessions — each in its own tmux session, each
driving a different platform (iOS simulator, web browser, etc.) — coordinate
through a shared folder of append-only markdown logs to run a real,
end-to-end interaction test between two user roles (e.g. vehicle owner and
service hero). Neither session can see the other's terminal output directly;
everything crosses through files, or through a tmux nudge when one session
goes idle. This document is the shared reference both sessions read and
extend — each side fills in its own platform-specific mechanics.

## Why this exists

A single Claude session can't drive two live apps as two different users at
once and have them interact in real time — you need two sessions, each fully
capable of using its own platform's tools (XCUITest for iOS, Playwright/
browser tools for web, etc.), operating independently but staying in sync on
what step of the test they're on. This skill is the coordination layer that
makes that work without either session going silent for 20+ minutes waiting
on the other.

## Two modes

- **Two-session peer mode** (the original): two Principal sessions coordinate
  directly, each driving one platform. Everything below ("Setup" onward) is
  the shared execution protocol for this.
- **Three-session orchestrated mode** (adds a governing layer): a **Lead Staff
  Engineer** session authors the plan and governs two **Principal Staff
  Engineer** sessions (one per platform). Read the next section first if a Lead
  is involved; the rest of the doc is still the execution protocol the two
  Principals follow.

**Which am I?** Your role is stated in the prompt that started you ("You are the
Lead Staff Engineer…" / "…the Web Principal…"). If unset, infer from your tmux
session name: `tmux display-message -p '#S'` — a `lead*` session is the Lead;
the platform repos (e.g. `exampleapp`, `exampleapp-ios`) are the Principals.

## Three-session orchestrated mode: Lead Staff + two Principals

### Roles

- **Lead Staff Engineer** (`lead` session — drives NO platform). Owns the
  `PLAN.md`. Discovers the sessions, authors the cross-platform test plan,
  distributes it, MONITORS all logs, steers/unblocks/re-plans, arbitrates
  which side owns a cross-platform bug, declares rounds done, and writes the
  final consolidation. It runs the test; it does not execute the steps.
- **Principal Staff Engineer — Web** (`exampleapp`-style session): drives the web
  app (browser tools). Executes its assigned steps, hands off peer-to-peer to
  the iOS Principal, ACKs Lead directives.
- **Principal Staff Engineer — iOS** (`exampleapp-ios`-style session): drives the
  iOS app (simulator/XCUITest). Mirror of the Web Principal.

### Topology: governing overlay (NOT a relay hub)

```
Lead ──plan/directives──▶ Web Principal
  │                          ▲   │
  │                    handoffs (peer-to-peer)
  │                          │   ▼
  └───plan/directives──▶ iOS Principal
  Lead watches all logs, steers; it is NOT in the path of every handoff.
```

The two Principals still execute the real interaction handoffs **directly**
between themselves (owner books → hero accepts → …), exactly as in two-session
mode. The Lead does not relay each message — it sets the plan, watches all
three logs, and intervenes only to unblock, redirect, re-pace, arbitrate bug
ownership, or advance a round. This keeps execution fast while adding governance.

### Shared-folder layout (three-session)

On top of the two-session layout (per-round `<role>-<platform>.md` logs):

- `PLAN.md` — **Lead-authored source of truth**. Objectives; round/phase
  structure; per-round role assignment (who's owner, who's hero); the step
  sequence; done-criteria; and the standing constraints (no fake writes,
  fix-on-the-owning-side, paced writes, backend-verify everything). Both
  Principals read this first and re-read whenever the Lead signals an update.
- `lead-log.md` — the Lead's running orchestration log: each **directive**
  (with a unique id like `D1`, `ROUND2-START`), acks tracked, round
  transitions, steering decisions, and the final consolidation.
- `acks.md` — the delivery-guarantee channel. Principals append `ACK <id>
  <session> <HH:MM>` lines here on receipt; the Lead watches it.

### Guaranteed communication: watcher + tmux nudge + ACK

Every directive is delivered with a three-part guarantee so nothing is silently
missed (the failure mode where a session has an un-submitted prompt in its box):

**Lead, to issue a directive:**
1. Write the directive to `lead-log.md` (and/or update `PLAN.md`) with a unique
   id.
2. Nudge BOTH Principals: `scripts/nudge.sh <session> "New directive <id> in
   lead-log.md — read it and ACK"`. The script sends the keys, presses Enter
   separately, and captures the pane so you SEE it landed.
3. Start the ack-watcher in the background:
   `scripts/await-acks.sh <folder>/acks.md <id> 90 <web-session> <ios-session>`.
   Exit 0 = both acked → proceed. Exit 2 = timeout → re-nudge whoever is `0`
   and `tmux capture-pane` them to confirm they're alive (not crashed) before
   escalating to the human.

**Principal, on receiving a directive** (via your watcher on `lead-log.md`/
`PLAN.md`, or a tmux nudge):
1. Immediately `scripts/ack.sh <folder>/acks.md <my-session> <id>` — ACK BEFORE
   you start acting, so the Lead's watcher clears.
2. Then comply. A Lead directive can override your current step; the Lead is
   the tie-breaker.

### The Lead's loop

1. **Discover**: `tmux ls`; confirm both Principal sessions exist and are at a
   ready prompt (`tmux capture-pane`). Note their exact session names.
2. **Author `PLAN.md`**: objectives, rounds, per-round roles, step sequence,
   done-criteria, constraints. Base it on real context (prior `FINDINGS.md`,
   `web-issues.md`/`ios-issues.md`, the test accounts, the current build state)
   rather than a generic template.
3. **Distribute (D0)**: write PLAN, issue directive `D0` = "read PLAN.md, ACK",
   nudge both, await both acks.
4. **Run each round**: issue the round directive, await acks, then let the
   Principals execute peer-to-peer. **Monitor** with
   `scripts/monitor-peers.sh <round>/<web-log> <round>/<ios-log>` in the
   background — on each change, read it and decide whether to steer (unblock a
   BLOCKED entry, arbitrate a cross-side bug, re-pace writes, redirect).
5. **Advance**: when both Principals report the round's terminal state
   (backend-verified from both sides), transition — swap roles, issue the next
   round directive.
6. **Consolidate**: when the plan's done-criteria are met, write the final
   summary into `lead-log.md`/`FINDINGS.md` and direct both Principals to wrap.

Re-baseline your watchers after any of your own writes (see the watcher gotcha
below) so you don't process your own edit as a Principal's reply.

**Context management for Principals (Lead responsibility).** Long runs burn a
Principal's context window. On each monitoring wake-up, also `tmux
capture-pane` both Principals and look for signs of a long context. There is
NO explicit "low context" warning — what you'll actually see is the session
itself hedging in its output: things like "this session is getting a little
long — do you want to stop here?", "we've covered a lot in this session",
or any message mentioning its context length / asking whether to stop. That
phrasing IS the signal. Timing rule: NEVER interrupt a session that is
actively working. Only compact when the session has STOPPED and its LAST
message is that kind of long-context/should-we-stop message. A stopped
session often has an unsubmitted draft sitting in its input box — send
`C-u` first to clear it, or your `/compact` text appends to the draft and
the slash command won't register. Then send it
`/compact <instructions to immediately pick up on>`
(e.g. "/compact resume Round R2 step R2-I2, log to roundR2/owner-ios.md,
re-read PLAN.md + lead-log.md") via the same send-keys pattern as a nudge.
A freshly-compacted session sits idle waiting for input — after compaction
completes, ALWAYS send an immediate follow-up nudge with the exact next step
(round/step id + log file), or the whole run stalls.

**Heartbeat (Lead responsibility).** Every ~5 minutes, send each Principal a
minimal nudge asking for a one-line status, so silent stalls are caught
early. Keep it token-cheap on both sides: the nudge is one short line, and
the expected reply is one short line — "OK: <what I'm on>" appended to
`heartbeat.md` in the shared folder (or nothing if they just answered).
Don't expect or demand more; if a Principal is mid-work the nudge simply
queues and costs almost nothing. Run this as a background loop (e.g. a
shell loop calling the nudge script every 300s, launched with the Bash
tool's `run_in_background: true` or a plain `&` — NOT `nohup`/`disown`)
rather than burning a Lead turn per beat; the Lead reads `heartbeat.md` on
its normal monitoring wake-ups and only intervenes when a beat shows a
stall or a Principal has gone quiet across multiple beats.

**Never launch the heartbeat loop (or any background watcher) with
`nohup`/`disown` or any other detaching mechanism.** A detached process is
no longer a child of the pane's shell, so killing the tmux session (what
the Director's teardown does) does NOT reap it — it keeps running
indefinitely, still firing nudges at the now-dead or reused session names.
This happened for real: orphaned heartbeat loops from finished activations
survived for over an hour and misfired straight into a freshly-spawned
team's Principal session before it had even been briefed. Keep background
loops as plain children (`run_in_background: true`, or `&` inside the same
shell) so they die naturally when the session is torn down. At Deactivation
time, don't just assume you killed it — `pgrep -f <your-session-name>`
and confirm zero matches before writing `cleanup=confirmed`.

**Progress journal in Apple Notes (Lead responsibility).** Keep a running
journal of the run in the macOS Notes app, in the folder named **"Claude"**:
roughly every 5 minutes of progress (a step completed, a directive issued, an
arbitration, a blocker), add a NEW note there containing the timestamp, the
date, and a short plain-language account of what has been happening — so the
human can follow along and look back later. Use EXACTLY this proven recipe — no trial and error:

```bash
open -gja Notes; sleep 4   # Notes MUST be running or osascript times out (-1712)
osascript <<'EOF'
tell application "Notes"
  tell account "iCloud"
    if not (exists folder "Claude") then make new folder with properties {name:"Claude"}
    make new note at folder "Claude" with properties {name:"XPlat Test Journal — YYYY-MM-DD HH:MM", body:"<div>line 1</div><div>line 2</div>"}
  end tell
end tell
EOF
```

Key facts: the -1712 AppleEvent timeout just means Notes isn't running —
launch it first; target `account "iCloud"` explicitly (a bare
`folder "Claude"` can fail to resolve); the body is HTML (`<div>` per line).
**Token efficiency: delegate each journal write to a `haiku`-model subagent**
(Agent tool, `model: "haiku"`) and paste this recipe into its prompt along
with the facts to record, so it executes it verbatim without exploring. The
Lead just fires the delegation on its normal monitoring wake-ups; don't burn
main-model turns formatting notes. Discipline check: on EVERY wake-up, if
≥5 minutes have passed since the last journal note and anything has
happened, fire the delegation before doing anything else — the skill text
doesn't act on its own; forgetting this is the common failure.

Same core loop as two-session mode (do step → **backend-verify** → log →
peer-handoff → no fake writes), plus:

- **First**: read `PLAN.md`, ACK `D0`. Do not start until you've seen the plan.
- **Watch TWO channels**, not one: the other Principal's round-log (peer
  handoffs) AND the Lead channel (`lead-log.md`/`PLAN.md`) for directives.
  A directive is ACKed immediately and can preempt your current step.
- **When blocked**, log `BLOCKED` in your round-log AND surface it to the Lead
  (append a `COORD` note the Lead will see) — the Lead arbitrates cross-side
  bug ownership and unblocks, so you don't stall waiting on the other Principal.

### Scripts

Reusable helpers live in `scripts/` next to this file:
`watch.sh <file> [interval] [tail] [timeout_secs]` (poll one file, exits 2 on
timeout with current tail), `monitor-peers.sh <fileA> <fileB> [interval]
[tail] [timeout_secs]` (Lead: poll two logs at once, same timeout behavior),
`nudge.sh` (tmux nudge + pane-verify), `ack.sh` (Principal: append an ACK),
`await-acks.sh` (Lead: block until both ack, timeout tells you who's missing).
All are macOS/Linux portable (`md5 -q` / `md5sum` fallback). **Always pass an
explicit timeout to `watch.sh`/`monitor-peers.sh`** — see "Avoiding blind
waits" below for why an untimed watch can block forever.
**Known await-acks.sh caveat:** session names that are substrings of each
other (e.g. `exampleapp` vs `exampleapp-ios`) can false-positive the shorter
name's ack count — an ack from `exampleapp-ios` matches a bare `exampleapp`
grep. After the watcher reports success, confirm with an exact-match grep
(`grep "ACK <id> <session> "` with trailing space or word boundary) before
treating the shorter-named session as acked.

## Setup

1. Pick a shared folder outside either repo, e.g.
   `~/Documents/<project>-crossplatform-test/`.
2. Write a `PROTOCOL.md` in that folder before starting, covering:
   - Test accounts/credentials for each role (e.g. `test.owner@x.test`,
     `test.hero@x.test`) and where they live (which backend project/env).
   - The step sequence per round, prefixed per role — e.g. `O1`, `O2`... for
     the owner-side steps, `H1`, `H2`... for the hero-side steps. Steps don't
     have to alternate in lockstep; each session works its own steps and
     watches for the other's completion markers to know when to proceed.
   - What "done" looks like for the whole test (e.g. a full booking lifecycle
     reaching a terminal state, verified from both sides).
3. Create one subfolder per round: `round1/`, `round2/`, etc. Roles swap
   between rounds (if session A played the owner in round 1, it plays the
   hero in round 2) so both platforms get tested performing both roles.
4. Inside each round folder, each session owns one append-only log file it
   writes to and the other reads: e.g. `round1/owner-ios.md` (written by
   the iOS session when it's playing owner) and `round1/hero-web.md`
   (written by the web session when it's playing hero). Naming convention:
   `<role>-<platform>.md`.

## Log entry format

Append-only, one block per update, never edit past entries:

```
## [HH:MM] STEP <id> DONE: <one-line summary>
- <finding or action, one per line>
- <finding or action>
```

or when blocked on the other session:

```
## [HH:MM] STEP <id> BLOCKED: <what's blocking and what you need>
```

or for out-of-band coordination that doesn't map to a numbered step (root
cause diagnoses, requests to check something, corrections):

```
## [HH:MM] COORD: <topic>
<details>
```

Read the *other* session's log before starting each step — it may contain a
diagnosis, a fix confirmation, or a redirection that changes what you should
do next.

## The core loop

1. Do your step (drive your platform's UI/API for your current role).
2. Verify the result independently of your own UI — don't trust that a
   screenshot showing success means the backend write actually landed. Query
   the actual backend directly (REST API, DB query, whatever's available)
   and confirm the real state matches. **This is the single most important
   discipline in this whole process** — see "No fake writes" below.
3. Append a log entry to your file with the real, verified result — including
   MISS/BLOCKED entries when something didn't work, not just successes.
4. Check the other session's log file for their latest state before deciding
   your next step.

## Avoiding blind waits: the background watcher pattern

Do not poll the other session's log file by re-reading it every N minutes in
a normal conversational turn — that burns a full reasoning turn just to
check a timestamp, and a naive fixed interval means you're either too slow
(other session replies in 30s, you find out in 5min) or wasteful (checking
every 30s for an hour).

Instead, run a background shell loop that polls the file's hash cheaply and
only surfaces a notification when it actually changes: `scripts/watch.sh`
(one file) or `scripts/monitor-peers.sh` (two files at once, Lead watching
both Principals). Both take an explicit timeout as their last argument.

**Rule 1 — read before you watch, every time, no exceptions.** A watcher
only detects a CHANGE from its baseline; it is structurally blind to a
condition that was already true the moment it started (the file's current
content already reflects the awaited event, so the hash never moves again
and the watcher blocks forever). This is a real, observed failure mode — a
Lead once sat blocked "waiting for Web's final check" for 40+ minutes while
that check had actually finished before the watch even began, and both
Principals sat idle the whole time because nothing ever told the Lead to
look. Before starting ANY watcher: `tail` or read the target file(s) and
`heartbeat.md` FIRST. If what you're waiting for already happened, act on
it immediately — do not start a watcher for an event that's already in the
past.

**Rule 2 — always pass an explicit timeout, never rely on an untimed loop.**
`watch.sh <file> [interval] [tail_lines] [timeout_secs]` and
`monitor-peers.sh <fileA> <fileB> [interval] [tail] [timeout_secs]` exit 0
with the new content on a real change, or exit 2 with the file's CURRENT
tail on timeout — either way you get control back and something to read.
Pick a timeout you'll actually want to re-assess at (300-600s is typical for
a single check; scale up for a check you know runs long). Never invoke
either script with timeout=0 (infinite) as your only wait — that recreates
the exact stuck-forever bug rule 1 exists to prevent.

```bash
# WRONG — no read-first, no timeout, can block forever on a race:
FILE="/path/to/round1/other-session.md"
BASELINE=$(md5 -q "$FILE")
until [ "$(md5 -q "$FILE")" != "$BASELINE" ]; do sleep 5; done

# RIGHT:
tail -30 /path/to/round1/other-session.md   # read current state first
scripts/watch.sh /path/to/round1/other-session.md 5 50 300   # then bounded watch
```

Run the watcher via the background-shell mechanism your session has (e.g.
Bash tool with `run_in_background: true`) so a long or timed-out watch
doesn't block your whole turn. Set a long fallback wakeup/timer (20-30 min)
as a backstop in case the loop dies, but the primary signal should be the
notification/exit, not the fallback timer.

**On timeout (exit 2): re-read the file directly, don't just re-watch
blindly.** The script already printed the current tail — treat that as the
ground truth of present state, not "still nothing happened." Decide from
what you actually see: if the awaited work is done (you simply missed the
transition), act on it now; if genuinely still pending, re-nudge the other
session and start a fresh watch with a fresh baseline; if it's been pending
across multiple consecutive timeouts, escalate (capture-pane the other
session to check it's not stuck/dead) rather than watching indefinitely.

**Gotcha:** if you write to your OWN log file after starting the watcher (a
routine coordination note, not the other session's reply), the watcher may
be pointed at your own file or otherwise trigger on your own edit. Always
watch the *other* session's file, and re-baseline (start a fresh watcher
with a fresh hash) immediately after any of your own writes to a file you're
also watching, so you don't spend a turn processing your own edit as if it
were their reply.

## When the other session goes fully idle: tmux

If the other session hasn't responded in a while and you suspect it's not
actually working (not just slow), check whether it's running in a tmux
session — Claude Code sessions launched this way are often named after the
project (e.g. a session named `exampleapp` for the web repo, `exampleapp-ios`
for the iOS repo):

```bash
tmux list-sessions
tmux capture-pane -t <session-name> -p -S -100   # last ~100 lines of that pane
```

A common failure mode: the other session is not stuck or crashed — it has a
fully-typed prompt sitting in its input box that was never submitted (e.g.
it drafted "Continue when X persists" and the Enter never landed, so it's
just idle waiting for input that will never come). You can directly nudge it:

```bash
tmux send-keys -t <session-name> "Check round1/your-file.md now — <brief status/ask>"
sleep 1
tmux send-keys -t <session-name> Enter
```

Then verify the nudge actually landed by capturing the pane again a few
seconds later — look for the message to have left the input box and the
session to show active work (spinner/"Running..." indicator), not just sit
there. Don't assume `send-keys` succeeded just because the command didn't
error.

This is a legitimate, expected part of the coordination — don't hesitate to
reach for it as soon as a wait feels longer than it should. It's much faster
than escalating to the human to go check manually, and doesn't require the
human to be watching either terminal.

## No fake writes — the standing rule

Never patch data directly to make a test pass, and never claim a step
succeeded because the UI looked right. Every bug found gets fixed **in the
actual application code, on the side that owns it** (client bug → fix the
client; rules/backend bug → fix the backend), then the real write is
re-attempted through the real app and reverified from the backend directly.
If you're blocked by a bug on the *other* platform's side, say so plainly,
give them a precise, evidence-backed diagnosis (exact error text, exact
payload, a reproduction that isolates client vs. server), and wait for their
real fix rather than working around it. This produces genuinely trustworthy
findings instead of a test that was quietly gamed to pass.

When you find a bug, before reporting a theory as fact: read the actual
source (don't guess from symptoms alone), and reproduce the failure via the
most isolated method available (e.g. a raw authenticated REST call bypassing
the app entirely) to prove which side owns it. This session repeatedly found
that a plausible-sounding theory (e.g. "your decoder must not handle X type")
was wrong when checked against the literal code, and that guessing costs
both sessions real time — cite line numbers and paste the actual function
when correcting the other session's diagnosis.

## Debugging when your test harness swallows console output

If UI-automation output (e.g. `xcodebuild test`) doesn't surface your app's
own `print()`/console logs, don't rely on them — write debug info directly
to a file both sessions/you can read:

```swift
// e.g. inside a Firestore write completion handler
let debugLogPath = "/path/to/shared/round-folder/ios-debug.log"
let line = "DEBUG <context>: \(error?.localizedDescription ?? "OK")\n"
let existing = (try? String(contentsOf: URL(fileURLWithPath: debugLogPath), encoding: .utf8)) ?? ""
try? (existing + line).write(to: URL(fileURLWithPath: debugLogPath), atomically: false, encoding: .utf8)
```

This turns a silent fire-and-forget write into hard, inspectable evidence of
exactly what the backend returned — critical for distinguishing "my client
code is broken" from "the backend rejected a valid write" (permission-denied
vs. a payload/shape bug look identical from the UI alone).

## Filing findings

At the end of each round (or the whole test), each platform's session
compiles its own findings into a single top-level file readable by both
sides and the human — e.g. `ios-issues.md` / `FINDINGS.md` in the shared
folder root (not inside a round subfolder, since it should survive/summarize
across rounds). Structure: severity-triaged, one item per bug/gap, each with
exact file/line references and how it was confirmed (not just "the UI looked
wrong"). Distinguish real bugs (fixed this session) from real feature gaps
(documented, not built, unless the human explicitly asks for a build pass) —
don't blur the two.

---

## Platform-specific notes

### iOS (XCUITest) — filled in by the iOS-side session

- Drive the app via a dedicated `XCUITest` target/file per round (e.g.
  `XPlatOwnerTests.swift`, `XPlatHeroTests.swift`), not ad-hoc scripts.
  Regenerate the Xcode project (`xcodegen generate`, if the repo uses
  XcodeGen) after adding a new test file — a folder-based `sources:` entry
  in `project.yml` does NOT auto-discover new files without regeneration.
- `waitTap()` helper: wait for existence, tap if hittable, else fall back to
  a raw coordinate tap. Still not bulletproof — see below.
- **Known flakiness and fixes**, roughly in the order they tend to bite:
  - iOS's native "Save Password?" AutoFill dialog appears after sign-in and
    silently swallows the next tap or two. Dismiss explicitly (look for a
    "Not Now" button) before continuing — this was the root cause of
    several "random multi-minute hang" symptoms that looked like animation
    or listener issues but weren't.
  - The same AutoFill "quick suggestion" chip can reappear after sending a
    text/chat message and block subsequent navigation. If a screen action
    right after a text send seems stuck, dismiss the keyboard/suggestion
    (e.g. tap the nav bar) before proceeding, or reorder steps so the
    message-send happens last, not blocking anything downstream.
  - Tab-bar switches (`app.buttons[label].tap()`) can silently no-op — the
    tap registers but the app's active-tab state doesn't change. Don't trust
    a single `tap()`; retry a few times, verifying via the button's
    `.isSelected` state or a content landmark unique to the destination
    screen before proceeding.
  - Accumulated flakiness across many consecutive long test runs in one
    simulator session can usually be cleared with `xcrun simctl shutdown
    <device-id> && xcrun simctl boot <device-id>` between runs if things get
    increasingly unreliable for no code-related reason.
  - `xcodebuild test`'s stdout does not reliably include the app process's
    own `print()` output — use the file-based debug-logging pattern above
    instead of trusting console-log absence as "no error occurred."
- Non-atomic file writes: use `atomically: false` when a test writes to the
  shared log/screenshot files — atomic writes (temp file + rename) were
  observed to hang indefinitely across the simulator/host filesystem
  boundary.
- Always cross-verify booking/record state via the backend's REST API (not
  just a screenshot) before logging a step as DONE — a decode fallback,
  optimistic local UI, or an id mismatch can make a failed write look
  identical to a successful one in a screenshot.

### Web (browser automation) — filled in by the web-side session

- **Driving the app.** Use the browser-automation tools available to the
  session (this run used the `claude-in-chrome` MCP tools; `playwright-cdp`
  works equally well against a debug-port Chrome). Batch predictable
  action sequences (`navigate → find → click → type → screenshot`) into a
  single `browser_batch`/multi-action call — it's dramatically faster than
  one round-trip per click, and the whole batch stops on the first error so
  you notice failures immediately. Prefer semantic `find`/`read_page`
  (accessibility-tree refs) over raw pixel coordinates; refs survive layout
  shifts, coordinates don't. Re-`find` after any navigation or re-render —
  refs (`ref_NN`) are invalidated by the next snapshot and calling a stale
  one errors.
- **Two same-origin sessions can't coexist in one browser profile.** A web
  app keyed on Firebase auth stores the session in localStorage/IndexedDB
  per *origin*, so you cannot be logged in as two different users on the
  same origin at once. When one session must play both roles briefly, or to
  keep the owner and hero on genuinely separate logins, split them across
  origins: `http://localhost:4200` for one role and `http://[::1]:4200`
  (IPv6 loopback) for the other — same dev server, distinct storage
  partitions, independent auth sessions in the same browser.
- **Known flakiness and fixes**, roughly in the order they tend to bite:
  - **Dev-server reloads log you out.** A hot-reload/HMR rebuild (triggered
    every time you edit app code mid-test) drops the browser's auth session —
    you'll navigate to a guarded route and silently land back on `/login`.
    After ANY code change + rebuild, assume you're logged out: re-run the
    quick-login before the next UI step. Don't interpret the login screen as
    a routing bug; it's just the reload.
  - **The dev server itself dies on session restart/compaction.** If the
    session that launched `npm start` restarts, the child process is gone and
    every navigation 404s/hangs. Re-launch it (`npm start` in the background)
    and wait for `:4200` to actually serve (`until curl -sf localhost:4200
    >/dev/null; do sleep 2; done`) before resuming — it costs a minute.
  - **Liquid-glass / CSS-transition surfaces defeat actionability checks.**
    Perpetual transitions make Playwright consider elements "never stable,"
    so `.click()` times out even though the element is visible. Fixes: add a
    global `prefers-reduced-motion` rule that collapses transitions and set
    `contextOptions: { reducedMotion: 'reduce' }` in the Playwright config;
    or fall back to a JS-level click (`element.click()` via an evaluate call)
    for the specific control. The reduced-motion fix is the durable one and
    is also an accessibility win.
  - **First-paint empty-shell race.** Widgets bound to a listener render
    their empty state for a beat before the first snapshot lands, so a
    screenshot taken too early shows "No X yet" / a blank shell that isn't
    real. Wait for a content landmark (or just re-screenshot after ~2s)
    before concluding a screen is empty — and fix the app side to hold a
    loading state until the first snapshot rather than flipping to empty
    optimistically.
  - **Quick-login button sometimes needs a second click** if pressed during
    the initial route resolution — verify you actually landed on the
    dashboard (not still on `/login`) before proceeding.
- **Verifying writes from the backend (the critical discipline).** Don't
  trust a green web screenshot. Query Firestore's REST API directly to
  confirm the real document state. Auth for the query, two ways:
  - *Admin read/patch* (for inspecting state or, sparingly, reverting a
    verification write): exchange the Firebase CLI's stored refresh token
    (`~/.config/configstore/firebase-tools.json`) at the Google OAuth token
    endpoint for an access token, then hit
    `https://firestore.googleapis.com/v1/projects/<proj>/databases/(default)/documents/...`.
    This bypasses security rules — good for observing truth, useless for
    testing whether a *rule* allows something.
  - *Client-auth as the actual test user* (to prove a rule permits a write
    the way the app would): `POST` to
    `identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=<webApiKey>`
    with the test creds (web API key is in `src/environments/environment.ts`),
    then use the returned `idToken` as the Bearer for the Firestore REST
    call. A raw PATCH here is subject to the exact same rules as the app, so
    a `200` vs `403` definitively isolates rules-vs-client. This is how a
    `confirmed→completed` 403 was proven to be a rules bug, not a client bug —
    reproduced identically with zero app involvement.
  - **Isolate one malformed field fast** by diffing the field *shapes*
    (`Object.keys(fields[k])[0]` = the value-type tag, e.g. `timestampValue`
    vs `doubleValue`) of a doc that works against one that doesn't. That diff
    is what surfaced the Timestamp-vs-Double date incompatibility in one
    query instead of reading two full documents by eye.
- **Fixing on the web/shared side without workarounds.** The web repo
  typically owns `firestore.rules` and `firestore.indexes.json` (the *shared*
  contract), so genuine backend-contract bugs (a status-transition state
  machine that doesn't match the status vocabulary both apps write, a missing
  composite index, an ownership rule that's unsatisfiable against the real
  data model) are fixed here and deployed to the DEV project only
  (`firebase deploy --only firestore:rules --project <dev>`), never prod.
  After deploying a rule fix, re-verify it as the real test user via the
  client-auth REST path above (403→200) *before* handing back to the other
  session — and if your verification write advanced the doc, revert just that
  one field via admin PATCH so the other platform's app performs the real
  write. That revert is not a "fake write" — it's restoring the true
  pre-action state so the app under test does the actual mutation.
- **Cross-platform data-shape tolerance is a web-code fix, not a data
  patch.** When the other platform writes a shape your deserializer chokes on
  (epoch-seconds Double vs Firestore Timestamp; `{seconds,nanoseconds}` from
  a JSON round-trip; a bare number that's seconds-not-millis), make the web
  reader tolerant of *all* shapes in one shared helper (`toJsDate`-style) and
  isolate per-document decode failures so one bad doc can't blank an entire
  list. Fixing the reader is the correct-side fix; patching the offending
  document is the workaround to avoid.
