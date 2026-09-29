import { useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { rememberedTenant } from '#/features/session/repository/useSessionQuery.ts';
import {
  isTenantName,
  LOGIN_ERROR,
  loginErrorMessage,
  signedInElsewhere,
  SYSTEM_TENANT,
  tenantPage,
  TENANT_NAME_PROBLEM,
  type Principal,
} from '#/features/session/service.ts';
import { useSignedIn } from '#/features/session/usecase/useSignedIn.ts';
import { useSignIn } from '#/features/session/usecase/useSignIn.ts';
import { useToasts } from '#/shared/repository/useToasts.ts';
import { useUrlSearch } from '#/shared/repository/useUrlSearch.ts';

export const CHOOSE_TENANT = 'choose';

export type Home =
  | { readonly kind: 'leaving'; readonly tenant: string | null }
  | {
      readonly kind: 'elsewhere';
      readonly principal: Principal;
      readonly tenant: string;
      readonly signIn: () => void;
    }
  | {
      readonly kind: 'choose';
      readonly remembered: string | null;
      // Why the last sign-in came back without a session, in words.
      readonly notice: string | null;
      // A system administrator enters a tenant rather than signing in to it.
      readonly enters: boolean;
      // A tenant administrator's session, which a sign-in elsewhere replaces.
      readonly replacing: Principal | null;
      readonly choose: (tenant: string) => void;
      readonly check: (tenant: string) => string | undefined;
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
  const [failed] = useState(() => {
    const code = params.get(LOGIN_ERROR);
    return code === null ? null : loginErrorMessage(code);
  });
  const navigate = useNavigate();
  const signIn = useSignIn();
  const asked = params.get('tenant');
  const named = asked !== null && isTenantName(asked) ? asked : null;
  const choosing = params.has(CHOOSE_TENANT);
  const system = principal?.tenant === SYSTEM_TENANT;

  const enter = (tenant: string): void => {
    if (principal !== null && (system || principal.tenant === tenant)) {
      navigate({ href: tenantPage(tenant) }).catch(() => undefined);
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
      useToasts.getState().push({
        tone: 'error',
        message: `The switch to another tenant did not complete: ${failed} You're still signed in to ${principal.tenant}.`,
      });
    }
    enter(tenant);
  };
  const elsewhere = named !== null && signedInElsewhere(principal, named);
  const target = elsewhere
    ? null
    : (named ?? (principal !== null && !choosing ? principal.tenant : null));
  useEffect(() => {
    if (target !== null && !left.current) leave(target);
    else if (target === null) drop(LOGIN_ERROR);
  });

  if (elsewhere && principal !== null) {
    return {
      kind: 'elsewhere',
      principal,
      tenant: named,
      signIn: () => {
        signIn(named, tenantPage(named));
      },
    };
  }
  if (target !== null) return { kind: 'leaving', tenant: target };
  return {
    kind: 'choose',
    remembered: rememberedTenant({ named, signedIn: principal !== null }),
    notice: failed,
    enters: system,
    replacing: principal !== null && !system ? principal : null,
    choose: leave,
    check: (tenant) => (isTenantName(tenant) ? undefined : TENANT_NAME_PROBLEM),
  };
}
