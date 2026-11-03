import type { LogoutDelivery } from '#/features/clients/types/logoutDelivery';
import type { Choice } from '#/shared/services/choice';
import { ANY_STATUS } from '#/shared/services/filters';

export const DELIVERIES_HEADING = 'Back-channel deliveries';
export const DELIVERIES_RULE =
  'The logout tokens queued for this address, most recent first. A delivery is failed once every attempt is spent. The token itself is never shown.';

export const NO_DELIVERIES = 'No logout token has been queued for this client.';

export const STATUS_OPTIONS: readonly Choice[] = [
  { id: ANY_STATUS, label: 'Any status' },
  { id: 'pending', label: 'Pending' },
  { id: 'delivered', label: 'Delivered' },
  { id: 'failed', label: 'Failed' },
];

// The tone a status is drawn in.
export type DeliveryTone = 'active' | 'warning' | 'danger';

export function deliveryTone(status: LogoutDelivery['status']): DeliveryTone {
  if (status === 'delivered') return 'active';
  return status === 'failed' ? 'danger' : 'warning';
}
