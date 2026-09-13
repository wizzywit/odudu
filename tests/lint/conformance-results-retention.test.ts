import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const RESULTS_DIR = path.resolve(import.meta.dirname, '../../infra/conformance/results');

// Each Basic OP run leaves a summary and the suite's own log export, and the
// zip is ~300KB that git keeps forever. Two runs are what the evidence needs:
// the current one, and the one it supersedes — a reader comparing them can see
// what a fix changed. A third is history nobody reads, so a new run prunes the
// oldest rather than accumulating. ADR 0016 explains why the exports are in
// the repository at all.
const RUNS_KEPT = 2;

function runNameOf(file: string): string {
  return file.replace(/-logs\.zip$/u, '').replace(/\.json$/u, '');
}

describe('the committed conformance exports stay bounded', () => {
  it('keeps the current run and the one it supersedes, and no more', async () => {
    const files = (await readdir(RESULTS_DIR)).filter((name) => !name.startsWith('.'));
    const runs = [...new Set(files.map(runNameOf))].sort();

    expect(
      runs.length,
      `results/ holds ${String(runs.length)} runs: ${runs.join(', ')}`,
    ).toBeLessThanOrEqual(RUNS_KEPT);
  });

  it('keeps both halves of every run it keeps — the summary is a claim, the log export is the evidence', async () => {
    const files = (await readdir(RESULTS_DIR)).filter((name) => !name.startsWith('.'));

    for (const run of new Set(files.map(runNameOf))) {
      expect(files, `${run} is missing its summary`).toContain(`${run}.json`);
      expect(files, `${run} is missing its log export`).toContain(`${run}-logs.zip`);
    }
  });
});
