import { AUDIT_QUERY_TOO_BROAD } from '@odudu/contracts/admin';
import { andList } from '#/shared/services/format';
import { edgeOfMinute } from '#/shared/services/dateTime';
import type { GatewayFailure } from '#/shared/services/result';
import { FILTER_LABELS, type AuditFilters } from '#/features/audit/services/filters';

export const TOO_BROAD_TITLE = 'These filters are too broad to search';

// The server stops an audit read that outlives its time bound, and says so
// with this type; narrowing the filters, above all by time, is the way out.
export function isTooBroad(failure: GatewayFailure | null): boolean {
  return (
    failure?.kind === 'problem' &&
    failure.problem.status === 400 &&
    failure.problem.type === AUDIT_QUERY_TOO_BROAD
  );
}

export function tooBroadAdvice(filters: AuditFilters): string {
  const held = (
    ['event_type', 'action', 'outcome', 'actor_subject_id', 'resource_type', 'resource_id'] as const
  )
    .filter((name) => filters[name] !== undefined)
    .map((name) => FILTER_LABELS[name]);
  const hasRange = filters.from !== undefined || filters.to !== undefined;
  const lead = `The trail could not be searched in time with ${andList(held)}, which few events share.`;
  return hasRange
    ? `${lead} Narrow the range, or drop one of them.`
    : `${lead} Choose a time range: the trail is ordered by time, so a range keeps the search short however many events match the rest.`;
}

const DAY_MS = 86_400_000;

// The day up to now, as the instants a range filter carries.
export function lastDay(now: Date): { from: string; to: string } {
  const iso = now.toISOString();
  return {
    from: edgeOfMinute(new Date(now.getTime() - DAY_MS).toISOString(), 'start'),
    to: edgeOfMinute(iso, 'end'),
  };
}
