import type {
  IssuePasswordResponse,
  ListCredentialsResponse,
  Lockout,
} from '@odudu/contracts/admin';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  clearLockout,
  deleteCredential,
  readCredentials,
  readLockout,
  revokeRecoveryCodes,
} from '#/features/subjects/adapter/subjects.ts';
import { issuePassword } from '#/shared/adapter/administrators.ts';
import { useSecretOnce, type SecretOnce } from '#/shared/repository/useSecretOnce.ts';
import type { GatewayFailure, GatewayResult } from '#/shared/transport/gateway.ts';
import { useTransport } from '#/shared/transport/useTransport.ts';

export type Read<T> =
  { status: 'loading' } | { status: 'ready'; data: T } | { status: 'failed'; retry: () => void };

function useSubjectRead<T>(
  key: readonly unknown[],
  asked: boolean,
  read: () => Promise<GatewayResult<T>>,
): Read<T> {
  const client = useQueryClient();
  const query = useQuery({ queryKey: key, queryFn: read, enabled: asked });
  const result = query.data;
  if (result === undefined) return { status: 'loading' };
  if (result.ok) return { status: 'ready', data: result.data };
  return {
    status: 'failed',
    retry: () => {
      client.invalidateQueries({ queryKey: key, exact: true }).catch(() => undefined);
    },
  };
}

function credentialsKey(tenant: string, id: string) {
  return ['credentials', tenant, id] as const;
}

function lockoutKey(tenant: string, id: string) {
  return ['lockout', tenant, id] as const;
}

export function useCredentials(
  tenant: string,
  id: string,
  asked: boolean,
): Read<ListCredentialsResponse> {
  const { gateway } = useTransport();
  return useSubjectRead(credentialsKey(tenant, id), asked, () =>
    readCredentials(gateway, tenant, id),
  );
}

export function useLockout(tenant: string, id: string, asked: boolean): Read<Lockout> {
  const { gateway } = useTransport();
  return useSubjectRead(lockoutKey(tenant, id), asked, () => readLockout(gateway, tenant, id));
}

export type CredentialChange =
  { kind: 'factor'; credentialId: string } | { kind: 'recovery-codes' } | { kind: 'lockout' };

export interface CredentialChanges {
  busy: boolean;
  run: (change: CredentialChange) => Promise<GatewayResult<undefined>>;
}

// Each change re-reads what it changed, so the tab shows the server's word.
export function useCredentialChanges(tenant: string, id: string): CredentialChanges {
  const { gateway } = useTransport();
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: (change: CredentialChange): Promise<GatewayResult<undefined>> => {
      switch (change.kind) {
        case 'factor':
          return deleteCredential(gateway, tenant, id, change.credentialId);
        case 'recovery-codes':
          return revokeRecoveryCodes(gateway, tenant, id);
        case 'lockout':
          return clearLockout(gateway, tenant, id);
      }
    },
    onSettled: (_result, _error, change) => {
      const key = change.kind === 'lockout' ? lockoutKey(tenant, id) : credentialsKey(tenant, id);
      client.invalidateQueries({ queryKey: key, exact: true }).catch(() => undefined);
    },
  });
  return { busy: mutation.isPending, run: (change) => mutation.mutateAsync(change) };
}

// Issuing replaces the password and clears any lockout, so both are read
// again. The caller is told how it ended from the write itself, not a render.
export function useIssuePassword(
  tenant: string,
  id: string,
  told: {
    issued: () => void;
    refused: (failure: GatewayFailure) => void;
  },
): SecretOnce<void, null> {
  const client = useQueryClient();
  return useSecretOnce({
    run: async (gateway) => {
      let result: GatewayResult<IssuePasswordResponse>;
      try {
        result = await issuePassword(gateway, tenant, id);
      } catch (error) {
        told.refused({ ok: false, kind: 'defect' });
        throw error;
      }
      if (!result.ok) {
        told.refused(result);
        return result;
      }
      for (const key of [credentialsKey(tenant, id), lockoutKey(tenant, id)]) {
        client.invalidateQueries({ queryKey: key, exact: true }).catch(() => undefined);
      }
      told.issued();
      return result;
    },
    split: (data) => ({ secret: data.password, rest: null }),
  });
}
