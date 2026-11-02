export {
  type Area,
  type RailLink,
  type RailSection,
  OVERVIEW,
  TENANT_AREAS,
  SYSTEM_AREAS,
  EVERY_AREA,
  areaAt,
} from '#/features/shell/services/areas';
export {
  holds,
  showsSystemArea,
  actsWithSystemAuthority,
  areaHref,
  systemRecordHref,
  railGroups,
  currentHref,
} from '#/features/shell/services/rail';
export {
  type PendingShape,
  type PendingPage,
  pendingPage,
  type AreaAccess,
  areaAccess,
} from '#/features/shell/services/pending';
export {
  brandText,
  areasLabel,
  signedInFrom,
  checkingText,
  tenantNotFoundText,
  dialogOpen,
  pathnameOf,
} from '#/features/shell/services/frame';
export { THEME_CHOICES, themeChoice } from '#/features/shell/services/theme';
