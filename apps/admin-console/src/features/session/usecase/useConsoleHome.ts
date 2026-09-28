import { useNavigate } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { rememberedTenant } from '#/features/session/repository/useSessionQuery.ts';
import {
  isTenantName,
  signedInElsewhere,
  SYSTEM_TENANT,
  tenantPage,
  TENANT_NAME_PROBLEM,
  type Principal,
} from '#/features/session/service.ts';
import { useSignedIn } from '#/features/session/usecase/useSignedIn.ts';
import { useSignIn } from '#/features/session/usecase/useSignIn.ts';
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
      // A system administrator enters a tenant rather than signing in to it.
      readonly enters: boolean;
      readonly choose: (tenant: string) => void;
      readonly check: (tenant: string) => string | undefined;
    };

// The bare console: a signed-in administrator goes on to their tenant; a
// tenant named by ?tenant= goes straight to its sign-in; otherwise the last
// tenant this browser signed in to is offered, else the question is asked.
// ?choose asks it anyway, which is how a signed-in administrator switches.
export function useConsoleHome(): Home {
  const { principal } = useSignedIn();
  const { params } = useUrlSearch();
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
    enter(tenant);
  };
  const elsewhere = named !== null && signedInElsewhere(principal, named);
  const target = elsewhere
    ? null
    : (named ?? (principal !== null && !choosing ? principal.tenant : null));
  useEffect(() => {
    if (target !== null && !left.current) leave(target);
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
    enters: system,
    choose: leave,
    check: (tenant) => (isTenantName(tenant) ? undefined : TENANT_NAME_PROBLEM),
  };
}
