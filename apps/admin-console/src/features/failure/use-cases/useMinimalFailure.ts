import type { FailureReport } from '#/features/failure/services/failureReport';
import { minimalFailureView } from '#/features/failure/services/failureView';

export function useMinimalFailure(report: FailureReport | null) {
  return minimalFailureView(report);
}
