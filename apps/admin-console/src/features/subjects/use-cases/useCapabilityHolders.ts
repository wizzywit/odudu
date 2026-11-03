import type { ListedSubject } from '@odudu/contracts/admin';
import { useState } from 'react';
import { usePrincipal, isSelf } from '#/entities/session';
import { useHolderList } from '#/features/subjects/repository/useHolders';
import { heldLines, type HeldLine } from '#/features/subjects/services/roles';
import { useUnsavedGuard } from '#/shared/repository/useUnsavedGuard';
import type { ResourceListState } from '#/shared/services/resourceList';
import { reachesEveryTenant } from '#/features/subjects/services/tenantReach';
import { subjectHref } from '#/features/subjects/services/subjectAddress';
import { subjectName } from '#/features/subjects/services/subjectName';

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
    holders: list.rows.map((subject) => {
      const held = subject.admin_capabilities ?? [];
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
