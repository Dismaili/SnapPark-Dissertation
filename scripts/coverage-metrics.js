#!/usr/bin/env node
/**
 * SnapPark coverage analyzer.
 *
 * Computes the four coverage metrics required by the dissertation directly
 * from Istanbul's coverage-final.json report:
 *
 *   1. Statement coverage              — every statement executed
 *   2. Decision coverage               — every if/ternary/switch outcome taken
 *   3. Condition coverage              — every short-circuit operand outcome taken
 *   4. Decision/Condition coverage     — IEEE 982 union: every decision outcome
 *                                        AND every condition outcome
 *
 * Why this works (and the previous approach didn't):
 *
 * V8 native coverage (vitest's default `provider: 'v8'`) only knows byte
 * ranges. It cannot distinguish a decision (`if (x)`) from a condition
 * (`a` in `a && b`) because both compile to the same bytecode pattern.
 * That is why earlier coverage runs reported branch coverage as a
 * "proxy" for condition / decision-condition coverage.
 *
 * Istanbul instruments the AST and so writes a `branchMap` whose entries
 * carry a `type` field — `if`, `cond-expr`, `switch` for decisions and
 * `binary-expr`, `default-arg` for conditions. Counting outcomes per type
 * yields genuine, separable percentages for each of the four metrics.
 *
 * Usage:
 *   node scripts/coverage-metrics.js <path-to-coverage-final.json> [<label>]
 *
 * Output: a single JSON object with one entry per metric. Each entry has
 * `hit`, `total`, and `pct`. The script is intentionally side-effect free
 * (just reads + prints) so it can be composed in the bash runner.
 */

import fs from 'node:fs';
import path from 'node:path';

const DECISION_TYPES  = new Set(['if', 'cond-expr', 'switch']);
const CONDITION_TYPES = new Set(['binary-expr', 'default-arg']);

const pct = (hit, total) =>
  total === 0 ? 100 : Number(((hit / total) * 100).toFixed(2));

const summarise = (file) => {
  const counts = {
    statement: { hit: 0, total: 0 },
    decision:  { hit: 0, total: 0 },
    condition: { hit: 0, total: 0 },
  };

  // Statements: every entry in `statementMap` is one statement; the matching
  // counter in `s` records how many times it ran.
  for (const id of Object.keys(file.statementMap || {})) {
    counts.statement.total += 1;
    if ((file.s?.[id] ?? 0) > 0) counts.statement.hit += 1;
  }

  // Branches: each entry in `branchMap` is a decision or a compound
  // condition. The matching `b[id]` is an array of per-outcome hit counts
  // (length 2 for `if`/`cond-expr`/`binary-expr`, N for `switch`).
  for (const [id, branch] of Object.entries(file.branchMap || {})) {
    const bucket = DECISION_TYPES.has(branch.type)
      ? counts.decision
      : CONDITION_TYPES.has(branch.type)
        ? counts.condition
        : null;

    if (!bucket) continue; // unknown type — skip rather than miscount

    const outcomes = file.b?.[id] ?? [];
    for (const hits of outcomes) {
      bucket.total += 1;
      if (hits > 0) bucket.hit += 1;
    }
  }

  return counts;
};

const aggregate = (report) => {
  const totals = {
    statement: { hit: 0, total: 0 },
    decision:  { hit: 0, total: 0 },
    condition: { hit: 0, total: 0 },
  };

  for (const file of Object.values(report)) {
    const fileCounts = summarise(file);
    for (const key of Object.keys(totals)) {
      totals[key].hit   += fileCounts[key].hit;
      totals[key].total += fileCounts[key].total;
    }
  }

  // IEEE 982 Decision/Condition coverage: every decision outcome AND every
  // condition outcome must be reached. Reported as a union percentage, the
  // same way commercial tools (e.g. Cantata, VectorCAST) present it.
  const decisionCondition = {
    hit:   totals.decision.hit   + totals.condition.hit,
    total: totals.decision.total + totals.condition.total,
  };

  return {
    statement:          { ...totals.statement, pct: pct(totals.statement.hit,          totals.statement.total) },
    decision:           { ...totals.decision,  pct: pct(totals.decision.hit,           totals.decision.total) },
    condition:          { ...totals.condition, pct: pct(totals.condition.hit,          totals.condition.total) },
    decisionCondition:  { ...decisionCondition, pct: pct(decisionCondition.hit,        decisionCondition.total) },
  };
};

const main = () => {
  const [, , reportPath, label] = process.argv;
  if (!reportPath) {
    console.error('usage: coverage-metrics.js <coverage-final.json> [<label>]');
    process.exit(2);
  }

  const abs = path.resolve(reportPath);
  if (!fs.existsSync(abs)) {
    console.error(`coverage report not found: ${abs}`);
    process.exit(1);
  }

  const report  = JSON.parse(fs.readFileSync(abs, 'utf8'));
  const metrics = aggregate(report);

  process.stdout.write(JSON.stringify({ label: label || abs, metrics }, null, 2));
  process.stdout.write('\n');
};

main();
