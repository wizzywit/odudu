import type { FailureReport } from '#/widgets/failure/services/failureReport';
import { minimalFailureView } from '#/widgets/failure/services/failureView';

export function useMinimalFailure(report: FailureReport | null) {
  return minimalFailureView(report);
}
