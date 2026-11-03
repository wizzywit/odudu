import { type Area } from '#/entities/area';
import { checkingText } from '#/widgets/shell/services/shellText';
import { type AreaAccess } from '#/widgets/shell/services/pending';
import { useArea } from '#/widgets/shell/use-cases/useArea';

export function useAreaGate(tenant: string, area: Area): { access: AreaAccess; checking: string } {
  return { access: useArea(tenant, area), checking: checkingText(area) };
}
