import { useState } from 'react';
import { usePrincipal, isSelf } from '#/entities/session';
import { useHolderList } from '#/features/subject-capabilities/repository/useHolders';
import { useUnsavedGuard } from '#/shared/repository/useUnsavedGuard';
import { STATUS_FILTER } from '#/shared/services/filters';
import type { ResourceListState } from '#/shared/services/resourceList';
import { holderFilterOptions } from '#/features/subject-capabilities/services/capabilityChoices';
import { reachesEveryTenant } from '#/features/subject-capabilities/services/tenantReach';
import { heldLines, type HeldLine } from '#/features/subject-capabilities/services/heldLines';
import { type ListedSubject, subjectHref, subjectName } from '#/entities/subject';

export interface Holder {
  subject: ListedSubject;
  name: string;
  href: string;
  lines: readonly HeldLine[];
  // manage-tenants, which in system reaches every other tenant.
  reachesEveryTenant: boolean;
  self: boolean;
}

export interface CapabilityHolders {
  list: ResourceListState<ListedSubject>;
  holders: readonly Holder[];
  // The options of the two filters above the list.
  statusFilter: readonly { id: string; label: string }[];
  capabilityFilter: readonly { id: string; label: string }[];
  // The holder whose capabilities are open for change, one at a time.
  open: string | null;
  // Asks before closing an editor holding unsaved edits.
  toggle: (id: string) => void;
}

export function useCapabilityHolders(tenant: string): CapabilityHolders {
  const principal = usePrincipal();
  const list = useHolderList(tenant);
  const [open, setOpen] = useState<string | null>(null);
  const request = useUnsavedGuard((guard) => guard.request);
  return {
    list,
    statusFilter: STATUS_FILTER,
    capabilityFilter: holderFilterOptions(tenant),
    holders: list.rows.map((subject) => {
      const held = subject.adminCapabilities ?? [];
      return {
        subject,
        name: subjectName(subject),
        href: subjectHref(tenant, subject.id),
        lines: heldLines(held),
        reachesEveryTenant: reachesEveryTenant(tenant, held),
        self: isSelf(principal, tenant, subject.id),
      };
    }),
    open,
    toggle: (id) => {
      request(() => {
        setOpen((was) => (was === id ? null : id));
      });
    },
  };
}
