import type { Subject } from '@odudu/contracts/admin';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ADMINISTRATORS } from '#/features/system-admins/repository/useSystemAdministrators.ts';
import {
  grantTenantAdmin,
  revokeAdministrator,
  type Refused,
  type Revoked,
} from '#/shared/repository/administratorRoles.ts';
import { SYSTEM_TENANT } from '#/shared/service/principal.ts';
import { useTransport } from '#/shared/transport/useTransport.ts';

export interface AdministratorChange {
  readonly busy: boolean;
  readonly grant: (subjectId: string) => Promise<Refused | null>;
  readonly revoke: (subject: Pick<Subject, 'id' | 'username'>) => Promise<Revoked>;
}

// Either way the holders are read again, since a refusal can mean the list
// was already out of date.
export function useAdministratorChange(): AdministratorChange {
  const { gateway } = useTransport();
  const client = useQueryClient();
  const reread = (): void => {
    for (const kind of ['list', 'count']) {
      client
        .invalidateQueries({ queryKey: [kind, SYSTEM_TENANT, ADMINISTRATORS] })
        .catch(() => undefined);
    }
  };
  const grant = useMutation({
    mutationFn: (subjectId: string) => grantTenantAdmin(gateway, SYSTEM_TENANT, subjectId),
    onSettled: reread,
  });
  const revoke = useMutation({
    mutationFn: (subject: Pick<Subject, 'id' | 'username'>) =>
      revokeAdministrator(gateway, SYSTEM_TENANT, subject),
    onSettled: reread,
  });
  return {
    busy: grant.isPending || revoke.isPending,
    grant: (subjectId) => grant.mutateAsync(subjectId),
    revoke: (subject) => revoke.mutateAsync(subject),
  };
}
