import { loadCreation, storeCreation } from '#/entities/creation-draft/adapter/creationStorage';
import {
  administratorOf,
  belongsTo,
  flowOf,
} from '#/entities/creation-draft/services/creationDraft';
import type { Creation, CreationFlow } from '#/entities/creation-draft/types/creation';

export function ownCreation(owner: string, flow: CreationFlow): Creation | null {
  const stored = loadCreation(owner, flow);
  return stored !== null && belongsTo(flow, stored) ? stored : null;
}

export function storedCreation(owner: string, tenant: string): Creation | null {
  return ownCreation(owner, flowOf(tenant));
}

export function beginAdministrator(
  owner: string,
  tenant: string,
  origin: 'created' | 'imported' | 'existing',
): void {
  storeCreation(owner, administratorOf(tenant, origin), flowOf(tenant));
}
