import { useLocation } from '@tanstack/react-router';
import {
  SWITCH_HREF,
  useAuthority,
  useAuthorityAnswered,
  useSignOut,
  type Principal,
} from '#/entities/session';
import { type RailSection } from '#/widgets/shell/services/railGroups';
import { dialogOpen, pathnameOf } from '#/widgets/shell/services/pageContext';
import { currentHref, railGroups, systemRecordHref } from '#/widgets/shell/services/railGroups';
import { actsWithSystemAuthority, showsSystemArea } from '#/widgets/shell/services/systemAuthority';
import { useDialogHost } from '#/shared/repository/useDialogHost';
import { useRailCollapsed } from '#/widgets/shell/repository/useRailCollapsed';
import { useUnsavedGuard } from '#/shared/repository/useUnsavedGuard';
import type { ThemeChoice } from '#/shared/services/theme';
import { useTheme } from '#/shared/repository/useTheme';

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
  const pathname = pathnameOf(publicHref, globalThis.location.origin);

  return {
    groups,
    checking,
    currentHref: currentHref(tenant, groups, pathname),
    systemAuthority: actsWithSystemAuthority(principal, tenant, authority),
    systemRecordHref: systemRecordHref(tenant),
    username: principal.username,
    signedInTo: principal.tenant,
    switchHref: SWITCH_HREF,
    collapsed,
    dialogOpen: dialogOpen(openDialogs, asking),
    setCollapsed,
    theme: theme.choice,
    chooseTheme: theme.choose,
    signOut,
  };
}
