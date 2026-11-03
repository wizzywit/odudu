import {
  listCredentialsResponseSchema,
  lockoutSchema,
  profileSchema,
  usernamePolicySchema,
  type AmendProfileRequest,
  type Credential as WireCredential,
  type Lockout as WireLockout,
  type Profile,
} from '@odudu/contracts/admin';
import type { Gateway, GatewayResult } from '#/shared/transport/gateway';
import { adminCall, mapResult, nothing } from '#/shared/adapter/route';
import { type CredentialChange } from '#/pages/subjects/services/credentialChange';
import type { Credential } from '#/pages/subjects/types/credential';
import type { Lockout } from '#/pages/subjects/types/lockout';

function credentialOf(wire: WireCredential): Credential {
  return {
    id: wire.id,
    type: wire.type,
    createdAt: wire.created_at,
    expired: wire.expired,
    recoveryCodeCount: wire.recovery_code_count,
  };
}

function lockoutOf(wire: WireLockout): Lockout {
  return {
    locked: wire.locked,
    lockedUntil: wire.locked_until,
    failureCount: wire.failure_count,
    lastFailureAt: wire.last_failure_at,
  };
}

export function readProfile(
  gateway: Gateway,
  tenant: string,
  subjectId: string,
): Promise<GatewayResult<Profile>> {
  return adminCall(gateway, 'GET', tenant, ['subjects', subjectId, 'profile'], {
    schema: profileSchema,
  });
}

export function amendProfile(
  gateway: Gateway,
  tenant: string,
  subjectId: string,
  changes: AmendProfileRequest,
  ifMatch: string,
): Promise<GatewayResult<Profile>> {
  return adminCall(gateway, 'PATCH', tenant, ['subjects', subjectId, 'profile'], {
    // A claim the form holds as '' is one the subject does not have.
    body: Object.fromEntries(
      Object.entries(changes).map(([claim, value]) => [claim, value === '' ? null : value]),
    ),
    ifMatch,
    schema: profileSchema,
  });
}

export async function readCredentials(
  gateway: Gateway,
  tenant: string,
  subjectId: string,
): Promise<GatewayResult<Credential[]>> {
  const result = await adminCall(gateway, 'GET', tenant, ['subjects', subjectId, 'credentials'], {
    schema: listCredentialsResponseSchema,
  });
  return mapResult(result, ({ items }) => items.map(credentialOf));
}

export function deleteCredential(
  gateway: Gateway,
  tenant: string,
  subjectId: string,
  credentialId: string,
  endSessions: boolean,
): Promise<GatewayResult<undefined>> {
  return adminCall(
    gateway,
    'DELETE',
    tenant,
    ['subjects', subjectId, 'credentials', credentialId],
    {
      query: new URLSearchParams({ end_sessions: String(endSessions) }),
      schema: nothing,
    },
  );
}

export function revokeRecoveryCodes(
  gateway: Gateway,
  tenant: string,
  subjectId: string,
  requireNewSet: boolean,
): Promise<GatewayResult<undefined>> {
  return adminCall(gateway, 'DELETE', tenant, ['subjects', subjectId, 'recovery-codes'], {
    query: new URLSearchParams({ require_new_set: String(requireNewSet) }),
    schema: nothing,
  });
}

export async function readLockout(
  gateway: Gateway,
  tenant: string,
  subjectId: string,
): Promise<GatewayResult<Lockout>> {
  const result = await adminCall(gateway, 'GET', tenant, ['subjects', subjectId, 'lockout'], {
    schema: lockoutSchema,
  });
  return mapResult(result, lockoutOf);
}

export function clearLockout(
  gateway: Gateway,
  tenant: string,
  subjectId: string,
): Promise<GatewayResult<undefined>> {
  return adminCall(gateway, 'DELETE', tenant, ['subjects', subjectId, 'lockout'], {
    schema: nothing,
  });
}

export async function readUsernameEditable(
  gateway: Gateway,
  tenant: string,
): Promise<GatewayResult<boolean>> {
  const result = await adminCall(gateway, 'GET', tenant, ['subjects', 'username-policy'], {
    schema: usernamePolicySchema,
  });
  return mapResult(result, (policy) => policy.username_editable);
}

// One request in every case: ending the sessions is the server's part of the
// removal, so a removal that goes through and a sessions end that fails
// cannot be reported as one.
export function changeCredential(
  gateway: Gateway,
  tenant: string,
  subjectId: string,
  change: CredentialChange,
): Promise<GatewayResult<undefined>> {
  if (change.kind === 'factor') {
    return deleteCredential(gateway, tenant, subjectId, change.credentialId, change.endSessions);
  }
  if (change.kind === 'recovery-codes') {
    return revokeRecoveryCodes(gateway, tenant, subjectId, change.requireNewSet);
  }
  return clearLockout(gateway, tenant, subjectId);
}
