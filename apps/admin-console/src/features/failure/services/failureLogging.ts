import type { FailureReport } from '#/features/failure/services/failureReport';

export type FailureSource = 'rendering' | 'caught' | 'uncaught' | 'recoverable';

export function failureLogLine(report: FailureReport, source: FailureSource): string {
  return `odudu console failure ${report.id} (${source}) at ${report.route}`;
}

export type CaughtBy = 'shows-id' | 'chunk' | 'other';

// A boundary that draws the id logs it itself; the chunk boundary draws no id
// and throws any error that is not a chunk failure on to one that does.
export function caughtIsLogged(by: CaughtBy, chunkError: boolean): boolean {
  if (by === 'shows-id') return false;
  return by === 'other' || chunkError;
}
