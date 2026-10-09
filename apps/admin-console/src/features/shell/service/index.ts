export {
  type Area,
  type RailLink,
  type RailSection,
  OVERVIEW,
  TENANT_AREAS,
  SYSTEM_AREAS,
  EVERY_AREA,
  areaAt,
} from '#/features/shell/service/areas.ts';
export {
  holds,
  showsSystemArea,
  actsWithSystemAuthority,
  areaHref,
  systemRecordHref,
  railGroups,
  currentHref,
} from '#/features/shell/service/rail.ts';
export {
  type PendingShape,
  type PendingPage,
  pendingPage,
  type AreaAccess,
  areaAccess,
} from '#/features/shell/service/pending.ts';
export {
  brandText,
  areasLabel,
  signedInFrom,
  checkingText,
  notBuiltText,
  tenantNotFoundText,
  dialogOpen,
  pathnameOf,
} from '#/features/shell/service/frame.ts';
export { THEME_CHOICES, themeChoice } from '#/features/shell/service/theme.ts';
