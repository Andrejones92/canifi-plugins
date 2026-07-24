#!/usr/bin/env node
'use strict';
/*
 * statusline-main-cost.js — live cost readout for the MAIN conversation
 * thread itself (as opposed to statusline-council-cost.js, scoped to one
 * /council workflow run, and statusline-agents-cost.js, scoped to plain
 * Agent-tool subagents). This is the top-level session transcript
 * (transcript_path from stdin) — every turn you and the user exchange
 * directly, independent of anything spawned.
 *
 * Reuses council-cost-lib.js for all rate/pricing/parsing math (single
 * source of truth, shared with the other two statuslines) — parseAgentFile
 * works unmodified here since the main transcript has the identical
 * {type:"assistant", message:{model, usage}} line shape as an agent
 * transcript.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

process.stdout.on('error', () => {});
process.on('uncaughtException', () => { try { process.exit(0); } catch (e) {} });

let lib;
try { lib = require(path.join(__dirname, 'council-cost-lib.js')); }
catch (e) { process.stdout.write(''); process.exit(0); }
const { parseAgentFile, costOfDims, ratesFor, formatMoney, OPUS_RATES, FABLE_RATES } = lib;
if (!parseAgentFile || !costOfDims) { process.stdout.write(''); process.exit(0); }

// ---- theme (violet accent — distinct from council's orange and agents' cyan) ----
const A = '\x1b[38;5;140m';   // accent (violet)
const DIM = '\x1b[2m';
const B = '\x1b[1m';
const OK = '\x1b[38;5;71m';   // green
const R = '\x1b[0m';
const DOT = '●';
// The main thread is "live" as long as the terminal session is open, even
// between turns while waiting on the user — so LIVE here just means "this
// session has had at least one turn", not a tight recency window like the
// other two statuslines use for detecting an actively-running agent.
const LIVE_WINDOW_MS = 30 * 60 * 1000;

function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); } catch (e) { return ''; }
}

function formatElapsed(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h${m % 60}m`;
}

function main() {
  let input = {};
  try { input = JSON.parse(readStdin()); } catch (e) { input = {}; }

  const tp = input && input.transcript_path;
  if (!tp) return process.stdout.write('');

  let mtimeMs = 0;
  try { mtimeMs = fs.statSync(tp).mtimeMs; } catch (e) { return process.stdout.write(''); }

  const dims = parseAgentFile(tp);
  if (!Object.keys(dims).length) return process.stdout.write('');

  const grand = { in: 0, out: 0, cr: 0, cw5: 0, cw1: 0 };
  const perModelCost = {};
  let blendedTotal = 0;
  for (const k of Object.keys(dims)) {
    const d = dims[k];
    for (const f of ['in', 'out', 'cr', 'cw5', 'cw1']) grand[f] += d[f];
    const rates = ratesFor(k, mtimeMs) || [0, 0, 0, 0, 0];
    const cost = costOfDims(d, rates);
    perModelCost[k] = cost;
    blendedTotal += cost;
  }

  const opusOnly = costOfDims(grand, OPUS_RATES);
  const fableOnly = costOfDims(grand, FABLE_RATES);
  const savedVsOpusPct = opusOnly > 0 ? Math.max(0, (opusOnly - blendedTotal) / opusOnly * 100) : 0;
  const savedVsFablePct = fableOnly > 0 ? Math.max(0, (fableOnly - blendedTotal) / fableOnly * 100) : 0;

  const totalInputLike = grand.in + grand.cr + grand.cw5 + grand.cw1;
  const cacheHitRatePct = totalInputLike > 0 ? (grand.cr / totalInputLike) * 100 : null;

  const now = Date.now();
  const isLive = (now - mtimeMs) < LIVE_WINDOW_MS;
  const updatedAgo = formatElapsed(now - mtimeMs);

  const badge = isLive
    ? `${OK}${DOT}${R} ${B}main${R}  ${OK}LIVE${R}  ${DIM}· updated ${updatedAgo} ago${R}`
    : `${DIM}${DOT} main  IDLE  ·  updated ${updatedAgo} ago${R}`;

  const line2 =
    `${A}${B}${formatMoney(blendedTotal)}${R}` +
    `   ${DIM}vs opus${R} ${OK}${savedVsOpusPct.toFixed(0)}% ↓${R}` +
    `   ${DIM}vs fable${R} ${OK}${savedVsFablePct.toFixed(0)}% ↓${R}` +
    (cacheHitRatePct != null ? `   ${DIM}cache${R} ${OK}${cacheHitRatePct.toFixed(0)}%${R}` : '');

  const order = ['opus', 'fable', 'sonnet', 'haiku', 'other'];
  const parts = order
    .filter(k => perModelCost[k] > 0)
    .map(k => `${DIM}${k}${R} ${formatMoney(perModelCost[k])}`);
  const line3 = parts.length ? parts.join(`  ${DIM}·${R}  `) : `${DIM}—${R}`;

  process.stdout.write([badge, line2, line3].join('\n'));
}

main();
