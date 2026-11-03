import type { Credential } from '#/features/subjects/types/credential';
import type { IssuedPassword } from '#/entities/subject';
import { subjectReadKey } from '#/shared/repository/queryKeys';
import { useInvalidate } from '#/shared/repository/useInvalidate';
import { useRead } from '#/shared/repository/useRead';
import type { Read } from '#/shared/services/read';
import {
  changeCredential,
  readCredentials,
  readLockout,
} from '#/features/subjects/adapter/subjects';
import { useSecretOnce, type SecretOnce } from '#/shared/repository/useSecretOnce';
import { useWrite, type Write } from '#/shared/repository/useWrite';
import type { GatewayFailure, GatewayResult } from '#/shared/transport/gateway';
import { useTransport } from '#/shared/transport/useTransport';
import { staleReadOf, type CredentialChange } from '#/features/subjects/services/credentialChange';
import { issuePassword } from '#/entities/subject';
import { type Lockout } from '#/features/subjects/types/lockout';

export function useCredentials(tenant: string, id: string, asked: boolean): Read<Credential[]> {
  const { gateway } = useTransport();
  return useRead(subjectReadKey('credentials', tenant, id), asked, () =>
    readCredentials(gateway, tenant, id),
  );
}

export function useLockout(tenant: string, id: string, asked: boolean): Read<Lockout> {
  const { gateway } = useTransport();
  return useRead(subjectReadKey('lockout', tenant, id), asked, () =>
    readLockout(gateway, tenant, id),
  );
}

export type { CredentialChange };

// Each change re-reads what it changed, so the tab shows the server's word.
export function useCredentialChanges(
  tenant: string,
  id: string,
): Write<CredentialChange, GatewayResult<undefined>> {
  const { invalidateExact } = useInvalidate();
  return useWrite({
    send: (gateway, change: CredentialChange) => changeCredential(gateway, tenant, id, change),
    onSettled: (_result, change) => {
      invalidateExact(subjectReadKey(staleReadOf(change), tenant, id));
    },
  });
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
  const { invalidateExact } = useInvalidate();
  return useSecretOnce({
    run: async (gateway) => {
      let result: GatewayResult<IssuedPassword>;
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
      invalidateExact(subjectReadKey('credentials', tenant, id));
      invalidateExact(subjectReadKey('lockout', tenant, id));
      told.issued();
      return result;
    },
    split: (data) => ({ secret: data.password, rest: null }),
  });
}

// The list read again, for a dialog about to be said against it.
export function useRefreshCredentials(tenant: string, id: string): () => void {
  const { invalidateExact } = useInvalidate();
  return () => {
    invalidateExact(subjectReadKey('credentials', tenant, id));
  };
}
