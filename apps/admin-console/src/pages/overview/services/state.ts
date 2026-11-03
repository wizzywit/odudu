import { holds } from '#/shared/services/access';
import type { AdminCapability, Authority } from '#/shared/services/principal';
import { type AttentionItem, needsAttention } from '#/pages/overview/services/attention';
import type { EntityRules } from '#/pages/overview/services/entityRules';
import { openPlaceLabel } from '#/pages/overview/services/panelText';
import { readyData } from '#/pages/overview/services/readState';
import type { AreaOf, OverviewReads } from '#/pages/overview/types/overviewReads';

export interface AttentionLink extends AttentionItem {
  href: string;
  // What the link says: it opens the area that fixes the item.
  linkLabel: string;
}

export interface AttentionState {
  status: 'checking' | 'ready';
  // Nothing to say, to check or to retry.
  clear: boolean;
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
  rules: EntityRules,
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
    rules,
  }).map((item) => {
    const place = areaOf(item.area);
    return { ...item, href: place.href, linkLabel: openPlaceLabel(place.label) };
  });
  const status =
    authority === undefined || used.some((read) => read.status === 'loading')
      ? 'checking'
      : 'ready';
  const failed = retries.length > 0;
  return {
    status,
    clear: isClear({ status, items, unchecked, failed }),
    items,
    unchecked,
    failed,
    retries,
  };
}

export function isClear(
  attention: Pick<AttentionState, 'status' | 'items' | 'unchecked' | 'failed'>,
): boolean {
  return (
    attention.status === 'ready' &&
    attention.items.length === 0 &&
    attention.unchecked.length === 0 &&
    !attention.failed
  );
}

// One retry that asks again for every read that failed.
export function withRetry({ retries, ...attention }: AttentionData): AttentionState {
  return {
    ...attention,
    retry: () => {
      for (const again of retries) again();
    },
  };
}
