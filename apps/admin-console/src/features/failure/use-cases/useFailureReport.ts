import { useEffect, useState } from 'react';
import {
  inDevelopment,
  logFailure,
  messageLabel,
  newFailureReport,
} from '#/features/failure/repository/failureReport';
import {
  failureDetails,
  shownMessage,
  type FailureReport,
} from '#/features/failure/services/report';

export interface FailureShown {
  report: FailureReport;
  details: string;
  message: string | null;
  // Empty in production, where there is no message to label.
  messageLabel: string;
}

// The id is made once, when the failure first appears, and logged with the
// whole error so a developer can match what a person quotes to the console.
export function useFailureReport(error: unknown, route: string): FailureShown {
  const [report] = useState(() => newFailureReport(route));
  useEffect(() => {
    logFailure(report, 'rendering', error);
  }, [report, error]);
  return {
    report,
    details: failureDetails(report),
    message: shownMessage(error, inDevelopment()),
    messageLabel: messageLabel(),
  };
}
