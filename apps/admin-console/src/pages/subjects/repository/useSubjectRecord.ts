import type { Profile } from '@odudu/contracts/admin';
import { useQueryClient } from '@tanstack/react-query';
import { amendProfile, readProfile, readUsernameEditable } from '#/pages/subjects/adapter/subjects';
import { listKey, recordKey, usernamePolicyKey } from '#/shared/lib/repository/queryKeys';
import { useInvalidate } from '#/shared/lib/repository/useInvalidate';
import { useRecord, type RecordEntry, type RecordState } from '#/shared/lib/repository/useRecord';
import type { SaveInput } from '#/shared/lib/repository/useSectionSave';
import { useRead } from '#/shared/lib/repository/useRead';
import { useWrite, type Write } from '#/shared/lib/repository/useWrite';
import { isStale } from '#/shared/lib/services/failure';
import type { Read } from '#/shared/lib/services/read';
import type { Gateway, GatewayResult } from '#/shared/api/transport/gateway';
import { useTransport } from '#/shared/api/transport/useTransport';
import {
  amendSubject,
  deleteSubject,
  readSubject,
  type Subject,
  profileRecord,
  subjectRecord,
} from '#/entities/subject';

export function useSubjectRecord(tenant: string, id: string): RecordState<Subject> {
  return useRecord({
    tenant,
    record: subjectRecord(id),
    read: (gateway) => readSubject(gateway, tenant, id),
  });
}

export function useProfileRecord(tenant: string, id: string): RecordState<Profile> {
  return useRecord({
    tenant,
    record: profileRecord(id),
    read: (gateway) => readProfile(gateway, tenant, id),
  });
}

export interface AccountValues extends Readonly<Record<string, unknown>> {
  username: string;
  email: string;
}

export function saveAccount(tenant: string, id: string) {
  return (gateway: Gateway, { changes, ifMatch }: SaveInput<AccountValues>) =>
    amendSubject(gateway, tenant, id, changes, ifMatch);
}

export type ClaimValues = Readonly<Record<string, string>>;

export function saveClaims(tenant: string, id: string) {
  return (gateway: Gateway, { changes, ifMatch }: SaveInput<ClaimValues>) =>
    amendProfile(gateway, tenant, id, changes, ifMatch);
}

export interface VerificationValues extends Readonly<Record<string, unknown>> {
  email_verified: boolean;
  phone_number_verified: boolean;
}

export function saveVerification(tenant: string, id: string) {
  return (gateway: Gateway, { changes, ifMatch }: SaveInput<VerificationValues>) =>
    amendProfile(gateway, tenant, id, changes, ifMatch);
}

// Enabling and disabling are one PATCH on the ETag the subject was read
// with; the answer replaces the record, so its sections rebase on it.
export function useSubjectEnabled(
  tenant: string,
  id: string,
  etag: string,
): Write<boolean, GatewayResult<Subject>> {
  const client = useQueryClient();
  const { invalidateExact } = useInvalidate();
  const key = recordKey(tenant, subjectRecord(id));
  return useWrite({
    send: (gateway, enabled: boolean) => amendSubject(gateway, tenant, id, { enabled }, etag),
    onSuccess: (result) => {
      if (result.ok) {
        client.setQueryData<RecordEntry<Subject>>(key, { result, by: 'save' });
      } else if (isStale(result)) {
        invalidateExact(key);
      }
    },
  });
}

export function useSubjectDeletion(
  tenant: string,
  id: string,
): Write<void, GatewayResult<undefined>> {
  const { invalidate } = useInvalidate();
  return useWrite({
    send: (gateway) => deleteSubject(gateway, tenant, id),
    onSuccess: (result) => {
      // The record's own entries are left to lapse: removing them while its
      // page is still mounted would read them again, and find nothing.
      if (!result.ok) return;
      invalidate(listKey(tenant, 'subjects'));
    },
  });
}

// Whether a rename would be accepted, as the tenant's policy says.
export function useUsernamePolicy(tenant: string): Read<boolean> {
  const { gateway } = useTransport();
  return useRead(usernamePolicyKey(tenant), true, () => readUsernameEditable(gateway, tenant));
}
