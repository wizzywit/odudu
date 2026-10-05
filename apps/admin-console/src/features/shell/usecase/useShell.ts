import { useLocation } from '@tanstack/react-router';
import { CHOOSE_TENANT, useAuthority, useAuthorityAnswered, useSignOut } from '#/features/session';
import {
  actsWithSystemAuthority,
  currentHref,
  railGroups,
  showsSystemArea,
  systemRecordHref,
  type RailSection,
} from '#/features/shell/service.ts';
import { useDialogHost } from '#/shared/repository/useDialogHost.ts';
import { useRailCollapsed } from '#/shared/repository/useRailCollapsed.ts';
import { useUnsavedGuard } from '#/shared/repository/useUnsavedGuard.ts';
import type { Principal } from '#/shared/service/principal.ts';
import type { ThemeChoice } from '#/shared/service/theme.ts';
import { useTheme } from '#/shared/repository/useTheme.ts';

export interface Shell {
  groups: readonly RailSection[];
  // Whoami has not answered yet, so the rail says it is checking.
  checking: boolean;
  currentHref: string | undefined;
  systemAuthority: boolean;
  systemRecordHref: string;
  username: string;
  signedInTo: string;
  switchHref: string;
  collapsed: boolean;
  dialogOpen: boolean;
  setCollapsed: (collapsed: boolean) => void;
  theme: ThemeChoice;
  chooseTheme: (choice: ThemeChoice) => void;
  signOut: () => void;
}

export function useShell(tenant: string, principal: Principal): Shell {
  const authority = useAuthority(tenant);
  const { publicHref } = useLocation();
  const signOut = useSignOut();
  const theme = useTheme();
  const [collapsed, setCollapsed] = useRailCollapsed();
  const openDialogs = useDialogHost((host) => host.open);
  // The guard's own dialog is left out of the host's count, so it is asked too.
  const asking = useUnsavedGuard((guard) => guard.pending !== null);
  const checking = !useAuthorityAnswered(tenant);
  const groups = railGroups(
    tenant,
    showsSystemArea(principal, tenant, authority),
    authority,
    checking,
  );
  const pathname = new URL(publicHref, globalThis.location.origin).pathname;

  return {
    groups,
    checking,
    currentHref: currentHref(tenant, groups, pathname),
    systemAuthority: actsWithSystemAuthority(principal, tenant, authority),
    systemRecordHref: systemRecordHref(tenant),
    username: principal.username,
    signedInTo: principal.tenant,
    switchHref: `/console/?${CHOOSE_TENANT}`,
    collapsed,
    dialogOpen: openDialogs > 0 || asking,
    setCollapsed,
    theme: theme.choice,
    chooseTheme: theme.choose,
    signOut,
  };
}
