import type { Subject } from '@odudu/contracts/admin';
import { useState } from 'react';
import { useEffectiveRoles } from '#/features/subjects/repository/useAccess.ts';
import { useHolderLists } from '#/features/subjects/repository/useHolders.ts';
import {
  heldSummary,
  subjectHref,
  subjectName,
  type HeldLine,
} from '#/features/subjects/service.ts';
import { holdingLabel, holdingsIn, type Holding } from '#/shared/service/capabilities.ts';

export interface Holder {
  subject: Subject;
  name: string;
  href: string;
  // What the lists say it holds, Full first, before its own read says how.
  holdings: readonly Holding[];
}

export interface CapabilityHolders {
  status: 'loading' | 'ready' | 'refused' | 'failed';
  holders: readonly Holder[];
  retry: () => void;
  // The holder whose capabilities are open for change, one at a time.
  open: string | null;
  toggle: (id: string) => void;
}

export function useCapabilityHolders(tenant: string): CapabilityHolders {
  const lists = useHolderLists(tenant);
  const [open, setOpen] = useState<string | null>(null);
  const toggle = (id: string): void => {
    setOpen((was) => (was === id ? null : id));
  };
  if (lists.status === 'loading') {
    return { status: 'loading', holders: [], retry: () => undefined, open, toggle };
  }
  if (lists.status === 'failed') {
    const refused = lists.failure.kind === 'problem' && lists.failure.problem.status === 403;
    return {
      status: refused ? 'refused' : 'failed',
      holders: [],
      retry: lists.retry,
      open,
      toggle,
    };
  }
  const holders = new Map<string, Holder>();
  for (const holding of holdingsIn(tenant)) {
    for (const subject of lists.byHolding.get(holding) ?? []) {
      const known = holders.get(subject.id);
      holders.set(subject.id, {
        subject,
        name: subjectName(subject),
        href: subjectHref(tenant, subject.id),
        holdings: [...(known?.holdings ?? []), holding],
      });
    }
  }
  return {
    status: 'ready',
    holders: [...holders.values()].sort((a, b) => a.name.localeCompare(b.name)),
    retry: () => undefined,
    open,
    toggle,
  };
}

// How one holder holds what it holds, once its own read answers; until
// then, what the lists said.
export function useHeldLines(tenant: string, holder: Holder): readonly HeldLine[] {
  const effective = useEffectiveRoles(tenant, holder.subject.id);
  if (effective.status === 'ready') return heldSummary(effective.data.items);
  const shown = holder.holdings.includes('tenant-admin')
    ? ['tenant-admin' as const]
    : holder.holdings;
  return shown.map((holding) => ({ holding, label: holdingLabel(holding), how: '' }));
}
