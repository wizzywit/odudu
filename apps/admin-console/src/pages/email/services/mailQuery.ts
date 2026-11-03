import type { Choice } from '#/shared/lib/services/choice';
import { ANY_STATUS, optionalFilter } from '#/shared/lib/services/filters';

// One page of the latest mail: the panel never reads more until asked.
export const MAIL_PAGE_SIZE = 20;

export const MAIL_STATUS_OPTIONS: readonly Choice[] = [
  { id: ANY_STATUS, label: 'Any status' },
  { id: 'queued', label: 'Queued' },
  { id: 'retrying', label: 'Retrying' },
  { id: 'failed', label: 'Failed' },
  { id: 'sent', label: 'Sent' },
];

export function mailQuery(status: string | null): Record<string, string> {
  return { limit: String(MAIL_PAGE_SIZE), ...optionalFilter('status', status) };
}
