import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const RESULTS_DIR = path.resolve(import.meta.dirname, '../../infra/conformance/results');

// Each run leaves a summary and the suite's own log export, and the zip is
// ~300KB that git keeps forever. Two runs are what the evidence needs per
// plan: the current one, and the one it supersedes — a reader comparing them
// can see what a fix changed. A third is history nobody reads, so a new run
// prunes the oldest rather than accumulating. ADR 0016 explains why the
// exports are in the repository at all. The cap is per plan, not global —
// Basic OP and Dynamic OP are separate pieces of evidence, and a run of one
// is not history for the other.
const RUNS_KEPT = 2;

function runNameOf(file: string): string {
  return file.replace(/-logs\.zip$/u, '').replace(/\.json$/u, '');
}

// A run name is "<plan>-<date>-<suite version>[-<label>]", e.g.
// "basic-op-2026-09-12-v5.1.36-rerun" or "dynamic-op-2026-09-19-v5.1.36".
// The plan is everything before the date.
function planOf(runName: string): string {
  const match = /^(.+?)-\d{4}-\d{2}-\d{2}-/u.exec(runName);
  const plan = match?.[1];
  if (plan === undefined) {
    throw new Error(`run name ${JSON.stringify(runName)} does not start with <plan>-<date>-`);
  }
  return plan;
}

describe('the committed conformance exports stay bounded', () => {
  it('keeps the current run and the one it supersedes, per plan, and no more', async () => {
    const files = (await readdir(RESULTS_DIR)).filter((name) => !name.startsWith('.'));
    const runs = [...new Set(files.map(runNameOf))].sort();
    const runsByPlan = new Map<string, string[]>();
    for (const run of runs) {
      const plan = planOf(run);
      runsByPlan.set(plan, [...(runsByPlan.get(plan) ?? []), run]);
    }

    for (const [plan, planRuns] of runsByPlan) {
      expect(
        planRuns.length,
        `results/ holds ${String(planRuns.length)} runs of ${plan}: ${planRuns.join(', ')}`,
      ).toBeLessThanOrEqual(RUNS_KEPT);
    }
  });

  it('keeps both halves of every run it keeps — the summary is a claim, the log export is the evidence', async () => {
    const files = (await readdir(RESULTS_DIR)).filter((name) => !name.startsWith('.'));

    for (const run of new Set(files.map(runNameOf))) {
      expect(files, `${run} is missing its summary`).toContain(`${run}.json`);
      expect(files, `${run} is missing its log export`).toContain(`${run}-logs.zip`);
    }
  });
});
