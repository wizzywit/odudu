import { areaAt } from '#/entities/area';
import { useArea } from '#/widgets/shell/use-cases/useArea';
import { systemCheckingText, SYSTEM_KICKER } from '#/widgets/shell/services/shellText';
import type { AreaAccess } from '#/widgets/shell/services/pending';

// Every page behind this gate belongs to the System area: shown only to a
// system administrator signed in to `system`, whatever tenant the address names.
export function useSystemArea(
  tenant: string,
  title: string,
): { access: AreaAccess; kicker: string; checking: string } {
  return {
    access: useArea(tenant, areaAt('tenants')),
    kicker: SYSTEM_KICKER,
    checking: systemCheckingText(title),
  };
}
