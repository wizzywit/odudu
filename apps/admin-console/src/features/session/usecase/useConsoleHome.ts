import { useNavigate } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { readLastTenant } from '#/features/session/repository/tenantMemory.ts';
import { isTenantName, SYSTEM_TENANT } from '#/features/session/service.ts';
import { useSignedIn } from '#/features/session/usecase/useSignedIn.ts';
import { useSignIn } from '#/features/session/usecase/useSignIn.ts';
import { useUrlSearch } from '#/shared/repository/useUrlSearch.ts';

export const CHOOSE_TENANT = 'choose';

export type Home =
  | { readonly kind: 'leaving'; readonly tenant: string | null }
  | {
      readonly kind: 'choose';
      readonly remembered: string | null;
      readonly choose: (tenant: string) => void;
      readonly check: (tenant: string) => string | undefined;
    };

function tenantPage(tenant: string): string {
  return `/console/${encodeURIComponent(tenant)}`;
}

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
  const target = named ?? (principal !== null && !choosing ? principal.tenant : null);
  useEffect(() => {
    if (target !== null && !left.current) leave(target);
  });

  if (target !== null) return { kind: 'leaving', tenant: target };
  return {
    kind: 'choose',
    remembered: choosing ? null : readLastTenant(),
    choose: leave,
    check: (tenant) =>
      isTenantName(tenant)
        ? undefined
        : 'A tenant name is lowercase letters, digits and hyphens, and neither starts nor ends with a hyphen.',
  };
}
