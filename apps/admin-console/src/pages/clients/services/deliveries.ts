import type { LogoutDelivery } from '#/pages/clients/types/logoutDelivery';
import type { Choice } from '#/shared/services/choice';
import { ANY_STATUS } from '#/shared/services/filters';
import { attemptsText } from '#/shared/services/format';

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

// A delivery as its table shows it.
export interface DeliveryRow {
  id: string;
  endpoint: string;
  status: LogoutDelivery['status'];
  tone: DeliveryTone;
  attempts: string;
  lastError: string | null;
  createdAt: string;
}

export function deliveryRow(delivery: LogoutDelivery): DeliveryRow {
  return {
    id: delivery.id,
    endpoint: delivery.endpoint,
    status: delivery.status,
    tone: deliveryTone(delivery.status),
    attempts: attemptsText(delivery.attempts),
    lastError: delivery.last_error,
    createdAt: delivery.created_at,
  };
}
