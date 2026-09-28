import { useLocation } from '@tanstack/react-router';
import {
  CHOOSE_TENANT,
  useAuthority,
  useSignOut,
  type Principal,
} from '#/features/session/index.ts';
import {
  actsWithSystemAuthority,
  currentHref,
  railGroups,
  showsSystemArea,
  type RailSection,
} from '#/features/shell/service.ts';
import { useDialogHost } from '#/shared/repository/useDialogHost.ts';
import { useRailCollapsed } from '#/shared/repository/useRailCollapsed.ts';
import type { ThemeChoice } from '#/shared/service/theme.ts';
import { useTheme } from '#/shared/repository/useTheme.ts';

export interface Shell {
  readonly groups: readonly RailSection[];
  readonly currentHref: string | undefined;
  readonly systemAuthority: boolean;
  readonly username: string;
  readonly signedInTo: string;
  readonly switchHref: string;
  readonly collapsed: boolean;
  readonly dialogOpen: boolean;
  readonly setCollapsed: (collapsed: boolean) => void;
  readonly theme: ThemeChoice;
  readonly chooseTheme: (choice: ThemeChoice) => void;
  readonly signOut: () => void;
}

export function useShell(tenant: string, principal: Principal): Shell {
  const authority = useAuthority(tenant);
  const { publicHref } = useLocation();
  const signOut = useSignOut();
  const theme = useTheme();
  const [collapsed, setCollapsed] = useRailCollapsed();
  const openDialogs = useDialogHost((host) => host.open);
  const groups = railGroups(tenant, showsSystemArea(principal, tenant, authority));
  const pathname = new URL(publicHref, globalThis.location.origin).pathname;

  return {
    groups,
    currentHref: currentHref(tenant, groups, pathname),
    systemAuthority: actsWithSystemAuthority(principal, tenant, authority),
    username: principal.username,
    signedInTo: principal.tenant,
    switchHref: `/console/?${CHOOSE_TENANT}`,
    collapsed,
    dialogOpen: openDialogs > 0,
    setCollapsed,
    theme: theme.choice,
    chooseTheme: theme.choose,
    signOut,
  };
}
