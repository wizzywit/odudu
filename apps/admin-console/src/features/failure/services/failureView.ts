import type { FailureReport } from '#/features/failure/services/failureReport';
import {
  BACK_TO_OVERVIEW_LABEL,
  FAILURE_TITLE,
  PANEL_WORDING,
  RELOAD_LABEL,
  ROOT_FAILURE_TEXT,
  ROUTE_FAILURE_TEXT,
  SHELL_FAILURE_TEXT,
  TRY_AGAIN_LABEL,
} from '#/features/failure/services/wording';
import { PRODUCT_NAME } from '#/shared/services/product';

export interface FailureShown {
  details: string;
  message: string | null;
  // Empty in production, where there is no message to label.
  messageLabel: string;
}

// Everything the shared panel is told to say, where a failure is drawn.
function panelOf(text: string, shown: FailureShown) {
  return { ...PANEL_WORDING, text, ...shown };
}

export function routeFailureView(standalone: boolean, shown: FailureShown) {
  return {
    brand: PRODUCT_NAME,
    panel: panelOf(standalone ? SHELL_FAILURE_TEXT : ROUTE_FAILURE_TEXT, shown),
    tryAgain: TRY_AGAIN_LABEL,
    backToOverview: BACK_TO_OVERVIEW_LABEL,
    reload: RELOAD_LABEL,
  };
}

export function rootFailureView(shown: FailureShown) {
  return {
    brand: PRODUCT_NAME,
    panel: panelOf(ROOT_FAILURE_TEXT, shown),
    reload: RELOAD_LABEL,
  };
}

export function minimalFailureView(report: FailureReport | null) {
  return {
    title: FAILURE_TITLE,
    text: ROOT_FAILURE_TEXT,
    idLine: report === null ? null : `Error ID: ${report.id}`,
    reload: RELOAD_LABEL,
  };
}
