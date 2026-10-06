import type { LogoutDelivery } from '@odudu/contracts/admin';
import type { StatusTone } from '#/shared/view/StatusTag';
import type { SelectOption } from '#/shared/view/Field';

export const DELIVERIES_HEADING = 'Back-channel deliveries';
export const DELIVERIES_RULE =
  'The logout tokens queued for this address, most recent first. A delivery is failed once every attempt is spent. The token itself is never shown.';

export const NO_DELIVERIES = 'No logout token has been queued for this client.';

export const ANY_STATUS = 'any';

export const STATUS_OPTIONS: readonly SelectOption[] = [
  { id: ANY_STATUS, label: 'Any status' },
  { id: 'pending', label: 'Pending' },
  { id: 'delivered', label: 'Delivered' },
  { id: 'failed', label: 'Failed' },
];

// A filter the server takes, or none for any.
export function statusFilter(choice: string): string | null {
  return choice === ANY_STATUS ? null : choice;
}

export function deliveryTone(status: LogoutDelivery['status']): StatusTone {
  if (status === 'delivered') return 'active';
  return status === 'failed' ? 'danger' : 'warning';
}

export function attemptsText(attempts: number): string {
  return attempts === 1 ? '1 attempt' : `${String(attempts)} attempts`;
}
