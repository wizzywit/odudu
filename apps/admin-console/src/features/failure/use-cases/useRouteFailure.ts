import { useParams, useRouterState } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { focusPageMain } from '#/features/failure/repository/failureReport';
import { routeTemplate } from '#/features/failure/services/routeTemplate';
import { useFailureReport, type FailureShown } from '#/features/failure/use-cases/useFailureReport';
import { overviewHref } from '#/entities/area';
import { useReloadConsole } from '#/entities/session';

export interface RouteFailureShown extends FailureShown {
  overviewHref: string;
  // Reloading asks the unsaved-changes guard first; trying again leaves
  // nothing, so it does not.
  reload: () => void;
  tryAgain: () => void;
}

export function useRouteFailure(error: unknown, reset: () => void): RouteFailureShown {
  const route = useRouterState({
    select: (state) => routeTemplate(state.matches),
  });
  const tenant = useParams({ strict: false, select: (params) => params.tenant });
  const shown = useFailureReport(error, route);
  const reload = useReloadConsole();
  const retried = useRef(false);
  // The panel and the button focus was on go when the page draws again;
  // focus goes to the page's main region rather than falling to the document.
  useEffect(
    () => () => {
      if (retried.current) focusPageMain();
    },
    [],
  );
  return {
    report: shown.report,
    details: shown.details,
    message: shown.message,
    messageLabel: shown.messageLabel,
    overviewHref: overviewHref(tenant),
    reload,
    tryAgain: () => {
      retried.current = true;
      reset();
    },
  };
}
