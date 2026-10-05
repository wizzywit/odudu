import type { ListedSubject } from '@odudu/contracts/admin';
import { useState } from 'react';
import { usePrincipal } from '#/features/session';
import { useHolderList } from '#/features/subjects/repository/useHolders.ts';
import { heldLines, subjectHref, subjectName, type HeldLine } from '#/features/subjects/service.ts';
import { useUnsavedGuard } from '#/shared/repository/useUnsavedGuard.ts';
import { MANAGE_TENANTS, TENANT_ADMIN } from '#/shared/service/administrators.ts';
import { SYSTEM_TENANT } from '#/shared/service/principal.ts';
import type { ResourceListState } from '#/shared/service/resourceList.ts';

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
  return {
    list,
    holders: list.rows.map((subject) => {
      const held = subject.admin_capabilities ?? [];
      return {
        subject,
        name: subjectName(subject),
        href: subjectHref(tenant, subject.id),
        lines: heldLines(held),
        reachesEveryTenant:
          tenant === SYSTEM_TENANT &&
          held.some((each) => each.name === MANAGE_TENANTS || each.name === TENANT_ADMIN),
        self: principal.tenant === tenant && principal.subjectId === subject.id,
      };
    }),
    open,
    toggle: (id) => {
      useUnsavedGuard.getState().request(() => {
        setOpen((was) => (was === id ? null : id));
      });
    },
  };
}
