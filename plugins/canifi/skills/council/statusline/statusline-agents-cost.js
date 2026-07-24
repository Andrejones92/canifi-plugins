#!/usr/bin/env node
'use strict';
/*
 * statusline-agents-cost.js — live cost readout for general-purpose Agent
 * tool calls in the CURRENT session (sibling of Council's workflow-scoped
 * statusline-council-cost.js, but scoped to plain subagents/agent-<id>.jsonl
 * files rather than subagents/workflows/wf_<id>/ directories).
 *
 * Reuses council-cost-lib.js for all rate/pricing/parsing math (single
 * source of truth, shared with the Council statusline) — this file only
 * discovers agent transcript files for this session, decides which are
 * "live" (touched in the last 8s) vs "done", and renders the bar. No
 * sentinel file, no manual bookkeeping — every render re-scans disk
 * (refreshInterval:2 in settings.json).
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

// ---- theme (cyan accent, distinct from council's orange, so the two are
// visually distinguishable if both ever render side by side) ----
const A = '\x1b[38;5;44m';    // accent (cyan)
const DIM = '\x1b[2m';
const B = '\x1b[1m';
const OK = '\x1b[38;5;71m';   // green
const R = '\x1b[0m';
const DOT = '●';
// NOTE: 8s (Council's workflow-agent window) is too tight here. Plain Agent
// tool calls in this project run long, uninstrumented shell commands (e.g.
// a 4x Cucumber/Playwright suite run can block 20-45+ min with ZERO
// transcript writes in between) — an 8s window flickers LIVE/DONE on every
// render even though the agent never stopped. 10 minutes comfortably covers
// realistic single-tool-call gaps while still flipping to DONE promptly
// once an agent is actually finished (nothing else touches the file after
// that point).
const LIVE_WINDOW_MS = 10 * 60 * 1000;

function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); } catch (e) { return ''; }
}
function sessionDirFrom(input) {
  const tp = input && input.transcript_path;
  if (tp && tp.endsWith('.jsonl')) return tp.slice(0, -'.jsonl'.length);
  return null;
}

// Discover every subagents/agent-<id>.jsonl for this session (plain Agent
// tool calls — NOT subagents/workflows/wf_*/, that's Council's territory).
function findAgentFiles(sessionDir) {
  const subagentsDir = path.join(sessionDir, 'subagents');
  let entries;
  try { entries = fs.readdirSync(subagentsDir, { withFileTypes: true }); }
  catch (e) { return []; }

  const out = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.startsWith('agent-') || !entry.name.endsWith('.jsonl')) continue;
    const id = entry.name.slice('agent-'.length, -'.jsonl'.length);
    const fp = path.join(subagentsDir, entry.name);
    let mtimeMs;
    try { mtimeMs = fs.statSync(fp).mtimeMs; } catch (e) { continue; }
    let meta = null;
    try { meta = JSON.parse(fs.readFileSync(path.join(subagentsDir, `agent-${id}.meta.json`), 'utf8')); }
    catch (e) { /* meta is optional */ }
    out.push({ id, fp, mtimeMs, meta });
  }
  return out;
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

  const sessionDir = sessionDirFrom(input);
  if (!sessionDir) return process.stdout.write('');

  const files = findAgentFiles(sessionDir);
  if (!files.length) return process.stdout.write('');

  const now = Date.now();
  const perModelDims = {};
  let liveCount = 0;
  let newestMtimeMs = 0; // most recent activity across ALL agents (live or not)
  const liveDescriptions = [];

  for (const f of files) {
    const dims = parseAgentFile(f.fp);
    for (const k of Object.keys(dims)) {
      const t = perModelDims[k] || (perModelDims[k] = { in: 0, out: 0, cr: 0, cw5: 0, cw1: 0 });
      for (const field of ['in', 'out', 'cr', 'cw5', 'cw1']) t[field] += dims[k][field];
    }
    newestMtimeMs = Math.max(newestMtimeMs, f.mtimeMs);
    const isLive = (now - f.mtimeMs) < LIVE_WINDOW_MS;
    if (isLive) {
      liveCount++;
      if (f.meta && f.meta.description) liveDescriptions.push(f.meta.description);
    }
  }

  if (!Object.keys(perModelDims).length) return process.stdout.write('');

  let blendedTotal = 0;
  const grand = { in: 0, out: 0, cr: 0, cw5: 0, cw1: 0 };
  const perModelCost = {};
  for (const k of Object.keys(perModelDims)) {
    const d = perModelDims[k];
    for (const field of ['in', 'out', 'cr', 'cw5', 'cw1']) grand[field] += d[field];
    const rates = ratesFor(k, now) || [0, 0, 0, 0, 0];
    const cost = costOfDims(d, rates);
    perModelCost[k] = cost;
    blendedTotal += cost;
  }

  const opusOnly = costOfDims(grand, OPUS_RATES);
  const fableOnly = costOfDims(grand, FABLE_RATES);
  const savedVsOpusPct = opusOnly > 0 ? Math.max(0, (opusOnly - blendedTotal) / opusOnly * 100) : 0;
  const savedVsFablePct = fableOnly > 0 ? Math.max(0, (fableOnly - blendedTotal) / fableOnly * 100) : 0;

  // Cache hit-rate: what fraction of all input tokens (fresh + cache-read +
  // cache-write) were actually served from cache. High is good — it means
  // repeated context (system prompt, re-read files, prior turns) is being
  // reused instead of re-billed at full input price on every turn.
  const totalInputLike = grand.in + grand.cr + grand.cw5 + grand.cw1;
  const cacheHitRatePct = totalInputLike > 0 ? (grand.cr / totalInputLike) * 100 : null;

  const anyLive = liveCount > 0;
  // The $ total only moves when a new assistant turn lands in some agent's
  // transcript (cost is billed per-turn, not continuously) — a long single
  // tool call (e.g. a 20min test run) can hold the number still for a
  // while. Surface "updated Ns ago" so a static number reads as current-
  // and-waiting, not frozen/broken.
  const updatedAgo = formatElapsed(now - newestMtimeMs);
  const badge = anyLive
    ? `${OK}${DOT}${R} ${B}agents${R}  ${OK}LIVE${R} ${liveCount} running ${DIM}(${files.length} total this session)${R}  ${DIM}· updated ${updatedAgo} ago${R}`
    : `${DIM}${DOT} agents  DONE  ${files.length} total  ·  idle ${updatedAgo}${R}`;

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

  const lines = [badge, line2, line3];
  if (anyLive && liveDescriptions.length) {
    const shown = liveDescriptions.slice(0, 3).map(d => d.length > 40 ? d.slice(0, 37) + '...' : d);
    lines.push(`${DIM}▸ ${shown.join('  ·  ')}${R}`);
  }

  process.stdout.write(lines.join('\n'));
}

main();
