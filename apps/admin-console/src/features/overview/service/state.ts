import { holds } from '#/shared/service/access.ts';
import type { AdminCapability, Authority } from '#/shared/service/principal.ts';
import { type AttentionItem, needsAttention } from '#/features/overview/service/attention.ts';
import { type OverviewReads, readyData } from '#/features/overview/service/reads.ts';
import { type AreaOf } from '#/features/overview/service/tiles.ts';

export interface AttentionLink extends AttentionItem {
  href: string;
  // The label of the area the link opens.
  place: string;
}

export interface AttentionState {
  status: 'checking' | 'ready';
  items: readonly AttentionLink[];
  // Capabilities a check needed and whoami says are not held.
  unchecked: readonly string[];
  failed: boolean;
  retry: () => void;
}

export interface AttentionData extends Omit<AttentionState, 'retry'> {
  // Asks again for each read that failed.
  retries: readonly (() => void)[];
}

// The attention checks read settings and the SMTP relay, the signing keys,
// and the client count.
const CHECKED_WITH: readonly AdminCapability[] = ['manage-tenant', 'manage-keys', 'manage-clients'];

export function attentionState(
  reads: OverviewReads,
  authority: Authority | undefined,
  areaOf: AreaOf,
  now: Date,
): AttentionData {
  const used = [reads.settings, reads.smtp, reads.keys, reads.counts.clients];
  const unchecked = authority === undefined ? [] : CHECKED_WITH.filter((c) => !holds(authority, c));
  const retries = used.flatMap((read) => (read.status === 'failed' ? [read.retry] : []));
  const items = needsAttention({
    settings: readyData(reads.settings),
    smtp: readyData(reads.smtp),
    keys: readyData(reads.keys),
    clients: readyData(reads.counts.clients),
    now,
  }).map((item) => {
    const place = areaOf(item.area);
    return { ...item, href: place.href, place: place.label };
  });
  return {
    status:
      authority === undefined || used.some((read) => read.status === 'loading')
        ? 'checking'
        : 'ready',
    items,
    unchecked,
    failed: retries.length > 0,
    retries,
  };
}

export function isClear(attention: Omit<AttentionState, 'retry'>): boolean {
  return (
    attention.status === 'ready' &&
    attention.items.length === 0 &&
    attention.unchecked.length === 0 &&
    !attention.failed
  );
}
