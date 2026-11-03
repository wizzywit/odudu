import { useEffect, useState } from 'react';
import {
  inDevelopment,
  logFailure,
  messageLabel,
  newFailureReport,
} from '#/features/failure/repository/failureReport';
import { failureDetails, shownMessage } from '#/features/failure/services/failureReport';
import type { FailureShown } from '#/features/failure/services/failureView';

// The id is made once, when the failure first appears, and logged with the
// whole error so a developer can match what a person quotes to the console.
export function useFailureReport(error: unknown, route: string): FailureShown {
  const [report] = useState(() => newFailureReport(route));
  useEffect(() => {
    logFailure(report, 'rendering', error);
  }, [report, error]);
  return {
    details: failureDetails(report),
    message: shownMessage(error, inDevelopment()),
    messageLabel: messageLabel(),
  };
}
