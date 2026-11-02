import {
  developmentMessageLabel,
  focusMain,
  isDevelopment,
  logError,
  randomBytes,
  reloadPage,
} from '#/features/failure/adapter/browser';
import {
  buildFailureReport,
  FAILURE_ID_LENGTH,
  failureLogLine,
  type FailureReport,
  type FailureSource,
} from '#/features/failure/services';
import { currentTime } from '#/shared/adapter/clock';

export function newFailureReport(route: string): FailureReport {
  return buildFailureReport({ bytes: randomBytes(FAILURE_ID_LENGTH), route, now: currentTime() });
}

export function logFailure(
  report: FailureReport,
  source: FailureSource,
  error: unknown,
  componentStack?: string,
): void {
  logError(failureLogLine(report, source), error, componentStack);
}

// A failure met outside any panel: no page shows its id, so the log line is
// all there is to match it by.
export function recordFailure(
  source: FailureSource,
  error: unknown,
  route: string,
  componentStack?: string,
): FailureReport {
  const report = newFailureReport(route);
  logFailure(report, source, error, componentStack);
  return report;
}

export function messageLabel(): string {
  return developmentMessageLabel();
}

export function inDevelopment(): boolean {
  return isDevelopment();
}

export function reloadWindow(): void {
  reloadPage();
}

export function focusPageMain(): void {
  focusMain();
}
