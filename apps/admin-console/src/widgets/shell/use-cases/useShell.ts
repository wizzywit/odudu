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
import { pageOrigin } from '#/shared/lib/platform/location';
import { useDialogHost } from '#/shared/lib/repository/useDialogHost';
import { useRailCollapsed } from '#/widgets/shell/repository/useRailCollapsed';
import { useUnsavedGuard } from '#/shared/lib/repository/useUnsavedGuard';
import { THEME_CHOICES, themeChoice } from '#/shared/lib/services/theme';
import type { ThemeSetting } from '#/widgets/shell/types/themeSetting';
import {
  areasLabel,
  brandText,
  signedInFrom,
  tenantNotFoundText,
} from '#/widgets/shell/services/shellText';
import { useTheme } from '#/shared/lib/repository/useTheme';

export interface Shell {
  groups: readonly RailSection[];
  // Whoami has not answered yet, so the rail says it is checking.
  checking: boolean;
  currentHref: string | undefined;
  systemAuthority: boolean;
  systemRecordHref: string;
  username: string;
  switchHref: string;
  collapsed: boolean;
  dialogOpen: boolean;
  setCollapsed: (collapsed: boolean) => void;
  brand: string;
  areasLabel: string;
  notFoundText: string;
  // Whose tenant the session was issued by, when that is not this one.
  signedInFrom: string | null;
  theme: ThemeSetting;
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
  const pathname = pathnameOf(publicHref, pageOrigin());

  return {
    groups,
    checking,
    currentHref: currentHref(tenant, groups, pathname),
    systemAuthority: actsWithSystemAuthority(principal, tenant, authority),
    systemRecordHref: systemRecordHref(tenant),
    username: principal.username,
    switchHref: SWITCH_HREF,
    collapsed,
    dialogOpen: dialogOpen(openDialogs, asking),
    setCollapsed,
    brand: brandText(tenant),
    areasLabel: areasLabel(tenant),
    notFoundText: tenantNotFoundText(tenant),
    signedInFrom: signedInFrom(principal.tenant, tenant),
    theme: {
      choice: theme.choice,
      options: THEME_CHOICES,
      parse: themeChoice,
      choose: theme.choose,
    },
    signOut,
  };
}
