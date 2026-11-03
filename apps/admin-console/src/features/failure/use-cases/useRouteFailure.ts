import { useParams, useRouterState } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { focusPageMain } from '#/features/failure/repository/failureReport';
import { routeTemplate } from '#/features/failure/services/routeTemplate';
import { routeFailureView } from '#/features/failure/services/failureView';
import { useFailureReport } from '#/features/failure/use-cases/useFailureReport';
import { overviewHref } from '#/entities/area';
import { useReloadConsole } from '#/entities/session';

export function useRouteFailure(error: unknown, reset: () => void, standalone: boolean) {
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
    view: routeFailureView(standalone, shown),
    overviewHref: overviewHref(tenant),
    // Reloading asks the unsaved-changes guard first; trying again leaves
    // nothing, so it does not.
    reload,
    tryAgain: () => {
      retried.current = true;
      reset();
    },
  };
}
