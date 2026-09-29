import type { Profile, Subject } from '@odudu/contracts/admin';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  amendProfile,
  amendSubject,
  deleteSubject,
  readProfile,
  readSubject,
  readUsernameEditable,
} from '#/features/subjects/adapter/subjects.ts';
import {
  recordKey,
  useRecord,
  type RecordEntry,
  type RecordState,
} from '#/shared/repository/useRecord.ts';
import type { SaveInput } from '#/shared/repository/useSectionSave.ts';
import type { Gateway, GatewayResult } from '#/shared/transport/gateway.ts';
import { useTransport } from '#/shared/transport/useTransport.ts';

export function subjectRecord(id: string): string {
  return `subjects/${id}`;
}

export function profileRecord(id: string): string {
  return `subjects/${id}/profile`;
}

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
  readonly username: string;
  readonly email: string;
}

// An emptied email is cleared, as the server keeps no empty one.
export function saveAccount(tenant: string, id: string) {
  return (gateway: Gateway, { changes, ifMatch }: SaveInput<AccountValues>) =>
    amendSubject(
      gateway,
      tenant,
      id,
      {
        ...(changes.username === undefined ? {} : { username: changes.username }),
        ...(changes.email === undefined
          ? {}
          : { email: changes.email === '' ? null : changes.email }),
      },
      ifMatch,
    );
}

export type ClaimValues = Readonly<Record<string, string>>;

// A claim the form holds as '' is one the subject does not have.
export function saveClaims(tenant: string, id: string) {
  return (gateway: Gateway, { changes, ifMatch }: SaveInput<ClaimValues>) =>
    amendProfile(
      gateway,
      tenant,
      id,
      Object.fromEntries(
        Object.entries(changes).map(([claim, value]) => [claim, value === '' ? null : value]),
      ),
      ifMatch,
    );
}

export interface VerificationValues extends Readonly<Record<string, unknown>> {
  readonly email_verified: boolean;
  readonly phone_number_verified: boolean;
}

export function saveVerification(tenant: string, id: string) {
  return (gateway: Gateway, { changes, ifMatch }: SaveInput<VerificationValues>) =>
    amendProfile(gateway, tenant, id, changes, ifMatch);
}

export interface SubjectChange<A> {
  readonly busy: boolean;
  readonly run: (arg: A) => Promise<GatewayResult<unknown>>;
}

// Enabling and disabling are one PATCH on the ETag the subject was read
// with; the answer replaces the record, so its sections rebase on it.
export function useSubjectEnabled(
  tenant: string,
  id: string,
  etag: string | null,
): SubjectChange<boolean> {
  const { gateway } = useTransport();
  const client = useQueryClient();
  const key = recordKey(tenant, subjectRecord(id));
  const mutation = useMutation({
    mutationFn: (enabled: boolean): Promise<GatewayResult<Subject>> =>
      etag === null
        ? Promise.resolve({ ok: false, kind: 'defect' })
        : amendSubject(gateway, tenant, id, { enabled }, etag),
    onSuccess: (result) => {
      if (result.ok) {
        client.setQueryData<RecordEntry<Subject>>(key, { result, by: 'save' });
      } else if (result.kind === 'problem' && result.problem.status === 412) {
        client.invalidateQueries({ queryKey: key, exact: true }).catch(() => undefined);
      }
    },
  });
  return { busy: mutation.isPending, run: (enabled) => mutation.mutateAsync(enabled) };
}

export function useSubjectDeletion(tenant: string, id: string): SubjectChange<void> {
  const { gateway } = useTransport();
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => deleteSubject(gateway, tenant, id),
    onSuccess: (result) => {
      if (!result.ok) return;
      client.removeQueries({ queryKey: recordKey(tenant, subjectRecord(id)) });
      client.removeQueries({ queryKey: recordKey(tenant, profileRecord(id)) });
      client.invalidateQueries({ queryKey: ['list', tenant, 'subjects'] }).catch(() => undefined);
    },
  });
  return { busy: mutation.isPending, run: () => mutation.mutateAsync() };
}

// Whether a rename would be accepted: true or false once read, null while
// it is not asked (the read needs manage-tenant), loading or refused.
export function useUsernameEditable(tenant: string, asked: boolean): boolean | null {
  const { gateway } = useTransport();
  const query = useQuery({
    queryKey: ['username-editable', tenant],
    queryFn: () => readUsernameEditable(gateway, tenant),
    enabled: asked,
  });
  const result = query.data;
  return asked && result?.ok === true ? result.data : null;
}
