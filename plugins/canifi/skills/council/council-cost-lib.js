#!/usr/bin/env node
'use strict';
/*
 * council-cost-lib.js — single source of truth for council workflow cost math.
 *
 * Parses a workflow run's per-agent transcripts and computes exact per-model
 * token usage + dollar cost, plus the "% saved vs a single-model run" deltas.
 * Used by BOTH the live statusline (statusline-council-cost.js) and the
 * finalizer (writes the OKF cost summary), so the numbers never diverge.
 *
 * API:   const { computeCost, formatMoney } = require('./council-cost-lib.js')
 *        const r = computeCost('/path/to/.../subagents/workflows/wf_<id>')
 * CLI:   node council-cost-lib.js /path/to/wf_<id>   ->  prints JSON to stdout
 *
 * Pricing verified from live Anthropic docs 2026-07-07. Sonnet 5 is date-gated
 * (intro $2/$10 through 2026-08-31, standard $3/$15 from 2026-09-01).
 */

const fs = require('fs');
const path = require('path');

const SONNET_INTRO_END = Date.UTC(2026, 8, 1); // 2026-09-01T00:00:00Z
function sonnetRates(now) {
  return (now == null ? Date.now() : now) < SONNET_INTRO_END
    ? [2, 10, 0.20, 2.50, 4.00]   // intro
    : [3, 15, 0.30, 3.75, 6.00];  // standard
}
// rates: [input, output, cacheRead, cacheWrite5m, cacheWrite1h] in $/Mtok
function ratesFor(model, now) {
  if (!model) return null;
  const m = String(model).toLowerCase();
  if (m.includes('haiku')) return [1, 5, 0.10, 1.25, 2.00];
  if (m.includes('sonnet')) return sonnetRates(now);
  if (m.includes('opus')) return [5, 25, 0.50, 6.25, 10.00];
  if (m.includes('fable') || m.includes('mythos')) return [10, 50, 1.00, 12.50, 20.00];
  return null;
}
const OPUS_RATES = [5, 25, 0.50, 6.25, 10.00];
const FABLE_RATES = [10, 50, 1.00, 12.50, 20.00];

function shortModel(model) {
  const m = String(model).toLowerCase();
  if (m.includes('haiku')) return 'haiku';
  if (m.includes('sonnet')) return 'sonnet';
  if (m.includes('opus')) return 'opus';
  if (m.includes('fable') || m.includes('mythos')) return 'fable';
  return 'other';
}

function formatMoney(n) {
  if (n >= 100) return '$' + n.toFixed(0);
  if (n >= 10) return '$' + n.toFixed(1);
  return '$' + n.toFixed(2);
}

function emptyDims() { return { in: 0, out: 0, cr: 0, cw5: 0, cw1: 0 }; }

// Parse one agent transcript -> per-model token dims, deduped by message.id
// (streaming emits multiple partials per id where output_tokens grows; keep
// the LAST occurrence per id, then sum).
function parseAgentFile(fp) {
  const perModel = {};
  let raw;
  try { raw = fs.readFileSync(fp, 'utf8'); } catch (e) { return perModel; }
  const lastById = new Map();
  for (const line of raw.split('\n')) {
    if (!line) continue;
    let o;
    try { o = JSON.parse(line); } catch (e) { continue; }
    if (o.type !== 'assistant') continue;
    const msg = o.message;
    if (!msg || !msg.usage) continue;
    const id = msg.id || o.uuid || Math.random().toString(36);
    lastById.set(id, { model: msg.model, usage: msg.usage });
  }
  for (const { model, usage } of lastById.values()) {
    const key = shortModel(model);
    const d = perModel[key] || (perModel[key] = emptyDims());
    d.in += usage.input_tokens || 0;
    d.out += usage.output_tokens || 0;
    d.cr += usage.cache_read_input_tokens || 0;
    const cc = usage.cache_creation || {};
    const w5 = cc.ephemeral_5m_input_tokens;
    const w1 = cc.ephemeral_1h_input_tokens;
    if (w5 != null || w1 != null) {
      d.cw5 += w5 || 0;
      d.cw1 += w1 || 0;
    } else {
      d.cw5 += usage.cache_creation_input_tokens || 0; // fallback: treat as 5m
    }
  }
  return perModel;
}

function mergeInto(target, src) {
  for (const k of Object.keys(src)) {
    const t = target[k] || (target[k] = emptyDims());
    for (const f of ['in', 'out', 'cr', 'cw5', 'cw1']) t[f] += src[k][f];
  }
}

function costOfDims(d, rates) {
  return (
    d.in * rates[0] + d.out * rates[1] + d.cr * rates[2] +
    d.cw5 * rates[3] + d.cw1 * rates[4]
  ) / 1e6;
}

function agentsDone(runDir) {
  try {
    const jl = fs.readFileSync(path.join(runDir, 'journal.jsonl'), 'utf8');
    const results = new Set();
    for (const line of jl.split('\n')) {
      if (!line) continue;
      let o; try { o = JSON.parse(line); } catch (e) { continue; }
      if (o.type === 'result' && o.agentId) results.add(o.agentId);
    }
    return results.size;
  } catch (e) { return 0; }
}

/*
 * computeCost(runDir[, opts]) -> {
 *   ok, runDir, agentFiles, agentsDone, newestMtimeMs,
 *   perModel: { <model>: { tokens:{in,out,cr,cw5,cw1}, cost } },
 *   grandTokens: {in,out,cr,cw5,cw1},
 *   blendedTotal, opusOnly, fableOnly, savedVsOpusPct, savedVsFablePct
 * }
 * opts.now (ms) — override the clock for the Sonnet intro/standard date gate
 *                 (used so historical runs price at the rate that was in effect).
 */
function computeCost(runDir, opts) {
  const now = opts && opts.now != null ? opts.now : Date.now();
  let files;
  try {
    files = fs.readdirSync(runDir).filter(f => f.startsWith('agent-') && f.endsWith('.jsonl'));
  } catch (e) {
    return { ok: false, error: 'run dir not readable: ' + runDir, runDir };
  }
  if (!files.length) return { ok: false, error: 'no agent transcripts in ' + runDir, runDir };

  const perModelDims = {};
  let newestMtime = 0;
  for (const f of files) {
    const fp = path.join(runDir, f);
    try { newestMtime = Math.max(newestMtime, fs.statSync(fp).mtimeMs); } catch (e) {}
    mergeInto(perModelDims, parseAgentFile(fp));
  }

  const grand = emptyDims();
  const perModel = {};
  let blendedTotal = 0;
  for (const k of Object.keys(perModelDims)) {
    const d = perModelDims[k];
    for (const f of ['in', 'out', 'cr', 'cw5', 'cw1']) grand[f] += d[f];
    const rates = ratesFor(k, now) || [0, 0, 0, 0, 0];
    const cost = costOfDims(d, rates);
    perModel[k] = { tokens: d, cost };
    blendedTotal += cost;
  }

  const opusOnly = costOfDims(grand, OPUS_RATES);
  const fableOnly = costOfDims(grand, FABLE_RATES);
  const savedVsOpusPct = opusOnly > 0 ? Math.max(0, (opusOnly - blendedTotal) / opusOnly * 100) : 0;
  const savedVsFablePct = fableOnly > 0 ? Math.max(0, (fableOnly - blendedTotal) / fableOnly * 100) : 0;

  return {
    ok: true,
    runDir,
    agentFiles: files.length,
    agentsDone: agentsDone(runDir),
    newestMtimeMs: newestMtime,
    perModel,
    grandTokens: grand,
    blendedTotal,
    opusOnly,
    fableOnly,
    savedVsOpusPct,
    savedVsFablePct,
  };
}

module.exports = {
  computeCost, formatMoney, ratesFor, shortModel, OPUS_RATES, FABLE_RATES,
  parseAgentFile, costOfDims, emptyDims, mergeInto,
};

// CLI: node council-cost-lib.js <runDir>  -> prints the computeCost JSON.
if (require.main === module) {
  const runDir = process.argv[2];
  if (!runDir) {
    process.stderr.write('usage: node council-cost-lib.js <workflow-run-transcript-dir>\n');
    process.exit(2);
  }
  process.stdout.write(JSON.stringify(computeCost(runDir), null, 2) + '\n');
}
