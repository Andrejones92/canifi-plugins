#!/usr/bin/env node
'use strict';
/*
 * statusline-combined.js — runs all three bundled cost statuslines and
 * stacks their output, main thread on top: statusline-main-cost.js (this
 * session's own direct turns), statusline-council-cost.js (workflow-scoped,
 * /council* runs), statusline-agents-cost.js (session-wide plain Agent tool
 * calls) below. Each sub-script already renders nothing if it has no
 * relevant data, so this just concatenates whatever they each produce with
 * a blank line between blocks when more than one is present.
 *
 * settings.json only supports a single statusLine.command — this file is
 * that single entry point when the user wants all readouts. All three
 * underlying scripts stay independently runnable/editable at their own
 * paths (this file is a thin wrapper, not a re-implementation).
 */

const { execFileSync } = require('child_process');
const path = require('path');

process.stdout.on('error', () => {});
process.on('uncaughtException', () => { try { process.exit(0); } catch (e) {} });

function readStdin() {
  const fs = require('fs');
  try { return fs.readFileSync(0, 'utf8'); } catch (e) { return ''; }
}

function run(scriptName, stdinData) {
  try {
    return execFileSync('node', [path.join(__dirname, scriptName)], {
      input: stdinData,
      encoding: 'utf8',
      timeout: 3000,
    }).trim();
  } catch (e) {
    return '';
  }
}

function main() {
  const stdinData = readStdin();
  const main_ = run('statusline-main-cost.js', stdinData);
  const council = run('statusline-council-cost.js', stdinData);
  const agents = run('statusline-agents-cost.js', stdinData);

  const blocks = [main_, council, agents].filter(Boolean);
  process.stdout.write(blocks.join('\n\n'));
}

main();
