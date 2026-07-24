#!/usr/bin/env node
'use strict';
/*
 * statusline-council-cost.js — live, workflow-scoped per-model cost readout
 * for a running council workflow.
 *
 * Cost math lives in the shared council-cost-lib.js (single source of truth;
 * the finalizer uses the same lib to write the OKF cost summary). This file
 * only handles: reading stdin, auto-discovering the active/most-recent run
 * dir under this session's subagents/workflows/, and rendering the bar.
 * Renders nothing when no council run has ever run in this session.
 *
 * No sentinel file, no manual "mark done" step required anywhere — this
 * always reflects reality by scanning disk on every render (refreshInterval
 * :2 in ~/.claude/settings.json). The run with the freshest journal.jsonl
 * mtime is "the" run; LIVE vs DONE is purely a function of how recently
 * that file was touched, not any external status flag.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

// Never crash the status bar on a broken/closed stdout or any error.
process.stdout.on('error', () => {});
process.on('uncaughtException', () => { try { process.exit(0); } catch (e) {} });

let lib;
try { lib = require(path.join(__dirname, 'council-cost-lib.js')); }
catch (e) { process.stdout.write(''); process.exit(0); }
const { computeCost, formatMoney } = lib;

// ---- theme ----
const A = '\x1b[38;5;208m';   // accent (TE orange-ish)
const DIM = '\x1b[2m';
const B = '\x1b[1m';
const OK = '\x1b[38;5;71m';    // green
const R = '\x1b[0m';
const DOT = '●';

function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); } catch (e) { return ''; }
}
function sessionDirFrom(input) {
  const tp = input && input.transcript_path;
  if (tp && tp.endsWith('.jsonl')) return tp.slice(0, -'.jsonl'.length);
  return null;
}

// Find the run dir (under {sessionDir}/subagents/workflows/wf_*) whose
// journal.jsonl was touched most recently. That is "the" active/last run —
// no sentinel file, no manual bookkeeping. Returns null if none exist.
function findLatestRunDir(sessionDir) {
  const workflowsDir = path.join(sessionDir, 'subagents', 'workflows');
  let entries;
  try { entries = fs.readdirSync(workflowsDir, { withFileTypes: true }); }
  catch (e) { return null; }

  let best = null;
  let bestMtime = -Infinity;
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('wf_')) continue;
    const journalPath = path.join(workflowsDir, entry.name, 'journal.jsonl');
    let mtimeMs;
    try { mtimeMs = fs.statSync(journalPath).mtimeMs; }
    catch (e) { continue; }
    if (mtimeMs > bestMtime) {
      bestMtime = mtimeMs;
      best = { runId: entry.name, dir: path.join(workflowsDir, entry.name) };
    }
  }
  return best;
}

function main() {
  let input = {};
  try { input = JSON.parse(readStdin()); } catch (e) { input = {}; }

  const sessionDir = sessionDirFrom(input);
  if (!sessionDir) return process.stdout.write('');

  const latest = findLatestRunDir(sessionDir);
  if (!latest) return process.stdout.write('');

  const r = computeCost(latest.dir);
  if (!r.ok) return process.stdout.write('');

  const skill = 'council';
  const runShort = latest.runId.slice(0, 11);
  const isLive = (Date.now() - r.newestMtimeMs) < 8000;

  const badge = isLive
    ? `${OK}${DOT}${R} ${B}${skill}${R}  ${DIM}${runShort}${R}  ${OK}LIVE${R}  ${DIM}·${R}  ${r.agentsDone}/${r.agentFiles}`
    : `${DIM}${DOT} ${skill}  ${runShort}  DONE  ${r.agentsDone}/${r.agentFiles}${R}`;

  // Cache hit-rate: fraction of all input-like tokens (fresh + cache-read +
  // cache-write) actually served from cache. High is good — repeated
  // context (task briefs, research files, prior turns) is being reused
  // instead of re-billed at full input price every turn.
  const gt = r.grandTokens;
  const totalInputLike = gt.in + gt.cr + gt.cw5 + gt.cw1;
  const cacheHitRatePct = totalInputLike > 0 ? (gt.cr / totalInputLike) * 100 : null;

  const line2 =
    `${A}${B}${formatMoney(r.blendedTotal)}${R}` +
    `   ${DIM}vs opus${R} ${OK}${r.savedVsOpusPct.toFixed(0)}% ↓${R}` +
    `   ${DIM}vs fable${R} ${OK}${r.savedVsFablePct.toFixed(0)}% ↓${R}` +
    (cacheHitRatePct != null ? `   ${DIM}cache${R} ${OK}${cacheHitRatePct.toFixed(0)}%${R}` : '');

  const order = ['opus', 'fable', 'sonnet', 'haiku', 'other'];
  const parts = order
    .filter(k => r.perModel[k] && r.perModel[k].cost > 0)
    .map(k => `${DIM}${k}${R} ${formatMoney(r.perModel[k].cost)}`);
  const line3 = parts.length ? parts.join(`  ${DIM}·${R}  `) : `${DIM}—${R}`;

  process.stdout.write([badge, line2, line3].join('\n'));
}

main();
