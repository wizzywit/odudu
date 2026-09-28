import { useLocation } from '@tanstack/react-router';
import { useState } from 'react';
import { CHOOSE_TENANT, useAuthority, type Principal } from '#/features/session/index.ts';
import {
  actsWithSystemAuthority,
  currentHref,
  railGroups,
  showsSystemArea,
  type RailSection,
} from '#/features/shell/service.ts';
import { readRailCollapsed, rememberRailCollapsed } from '#/shared/repository/railChoice.ts';
import type { ThemeChoice } from '#/shared/service/theme.ts';
import { useDrafts } from '#/shared/repository/useDrafts.ts';
import { useTheme } from '#/shared/repository/useTheme.ts';
import { useToasts } from '#/shared/repository/useToasts.ts';
import { useUnsavedGuard } from '#/shared/repository/useUnsavedGuard.ts';
import { isSessionEnded } from '#/shared/transport/problem.ts';
import { useTransport } from '#/shared/transport/useTransport.ts';

export interface Shell {
  readonly groups: readonly RailSection[];
  readonly currentHref: string | undefined;
  readonly systemAuthority: boolean;
  readonly username: string;
  readonly signedInTo: string;
  readonly switchHref: string;
  readonly collapsed: boolean;
  readonly setCollapsed: (collapsed: boolean) => void;
  readonly theme: ThemeChoice;
  readonly chooseTheme: (choice: ThemeChoice) => void;
  readonly signOut: () => void;
}

export function useShell(tenant: string, principal: Principal): Shell {
  const authority = useAuthority(tenant);
  const { publicHref } = useLocation();
  const { auth, leavePage } = useTransport();
  const theme = useTheme();
  const [collapsed, setCollapsed] = useState(readRailCollapsed);
  const groups = railGroups(tenant, showsSystemArea(principal, tenant, authority));
  const pathname = new URL(publicHref, globalThis.location.origin).pathname;

  const signOut = async (): Promise<void> => {
    const result = await auth.logout();
    const guard = useUnsavedGuard.getState();
    const gone =
      result.ok ||
      result.kind === 'schema' ||
      (result.kind === 'problem' && isSessionEnded(result.problem));
    if (!gone) {
      useToasts.getState().push({ tone: 'error', message: 'Could not sign out. Try again.' });
      return;
    }
    useDrafts.getState().forgetAll();
    guard.release();
    leavePage(result.ok ? result.redirect : '/console/');
  };

  return {
    groups,
    currentHref: currentHref(tenant, groups, pathname),
    systemAuthority: actsWithSystemAuthority(principal, tenant, authority),
    username: principal.username,
    signedInTo: principal.tenant,
    switchHref: `/console/?${CHOOSE_TENANT}`,
    collapsed,
    setCollapsed: (next) => {
      rememberRailCollapsed(next);
      setCollapsed(next);
    },
    theme: theme.choice,
    chooseTheme: theme.choose,
    signOut: () => {
      useUnsavedGuard.getState().request(() => {
        signOut().catch(() => undefined);
      });
    },
  };
}
