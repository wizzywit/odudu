import { useEffect, useRef, useState } from 'react';
import { rememberedTenant } from '#/features/session/repository/useSessionQuery';
import {
  CHOOSE_TENANT,
  entersDirectly,
  homeTarget,
  isSystemPrincipal,
  LOGIN_ERROR,
  loginNotice,
  namedTenant,
  replacedSession,
  switchFailedText,
  tenantProblem,
  type Principal,
} from '#/features/session/services';
import { useSignedIn } from '#/features/session/use-cases/useSignedIn';
import { useSignIn } from '#/features/session/use-cases/useSignIn';
import { useGo } from '#/shared/repository/useGo';
import { useToast } from '#/shared/repository/useToasts';
import { useUrlSearch } from '#/shared/repository/useUrlSearch';
import { tenantPage } from '#/shared/services/address';

export type Home =
  | { kind: 'leaving'; tenant: string | null }
  | {
      kind: 'elsewhere';
      principal: Principal;
      tenant: string;
      signIn: () => void;
    }
  | {
      kind: 'choose';
      remembered: string | null;
      // Why the last sign-in came back without a session, in words.
      notice: string | null;
      // A system administrator enters a tenant rather than signing in to it.
      enters: boolean;
      // A tenant administrator's session, which a sign-in elsewhere replaces.
      replacing: Principal | null;
      choose: (tenant: string) => void;
      check: (tenant: string) => string | undefined;
    };

// The bare console: a signed-in administrator goes on to their tenant; a
// tenant named by ?tenant= goes straight to its sign-in; otherwise the last
// tenant this browser signed in to is offered, else the question is asked.
// ?choose asks it anyway, which is how a signed-in administrator switches.
// A sign-in that came back with ?login_error= says why: on the question
// page, or for a switch that left the old session standing, in a toast on
// the way back to that session's tenant.
export function useConsoleHome(): Home {
  const { principal } = useSignedIn();
  const { params, drop } = useUrlSearch();
  const [failed] = useState(() => loginNotice(params.get(LOGIN_ERROR)));
  const go = useGo();
  const toast = useToast();
  const signIn = useSignIn();
  const named = namedTenant(params.get('tenant'));
  const target = homeTarget({ principal, named, choosing: params.has(CHOOSE_TENANT) });

  const enter = (tenant: string): void => {
    if (entersDirectly(principal, tenant)) {
      go(tenantPage(tenant));
    } else {
      signIn(tenant, tenantPage(tenant));
    }
  };

  // Once this page has sent the administrator somewhere, it sends them
  // nowhere else while the router is still on its way there.
  const left = useRef(false);
  const leave = (tenant: string): void => {
    left.current = true;
    if (failed !== null && principal !== null) {
      toast.failed(switchFailedText(failed, principal.tenant));
    }
    enter(tenant);
  };
  useEffect(() => {
    if (target.kind === 'leaving' && !left.current) leave(target.tenant);
    else if (target.kind !== 'leaving') drop(LOGIN_ERROR);
  });

  if (target.kind === 'elsewhere') {
    const { tenant } = target;
    return {
      kind: 'elsewhere',
      principal: target.principal,
      tenant,
      signIn: () => {
        signIn(tenant, tenantPage(tenant));
      },
    };
  }
  if (target.kind === 'leaving') return { kind: 'leaving', tenant: target.tenant };
  return {
    kind: 'choose',
    remembered: rememberedTenant({ named, signedIn: principal !== null }),
    notice: failed,
    enters: isSystemPrincipal(principal),
    replacing: replacedSession(principal),
    choose: leave,
    check: tenantProblem,
  };
}
