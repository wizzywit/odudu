import {
  listCredentialsResponseSchema,
  lockoutSchema,
  profileSchema,
  subjectSchema,
  usernamePolicySchema,
  type AmendProfileRequest,
  type AmendSubjectRequest,
  type ListCredentialsResponse,
  type Lockout,
  type Profile,
  type Subject,
} from '@odudu/contracts/admin';
import type { CredentialChange } from '#/features/subjects/services';
import type { Gateway, GatewayResult } from '#/shared/transport/gateway';
import { readSubjectCount, readSubjectPage } from '#/shared/adapter/directory';
import { adminCall, nothing } from '#/shared/adapter/route';

export { readSubjectCount, readSubjectPage };

export function readSubject(
  gateway: Gateway,
  tenant: string,
  subjectId: string,
): Promise<GatewayResult<Subject>> {
  return adminCall(gateway, 'GET', tenant, ['subjects', subjectId], { schema: subjectSchema });
}

export function amendSubject(
  gateway: Gateway,
  tenant: string,
  subjectId: string,
  changes: AmendSubjectRequest,
  ifMatch: string,
): Promise<GatewayResult<Subject>> {
  return adminCall(gateway, 'PATCH', tenant, ['subjects', subjectId], {
    // The server keeps no empty email, so an emptied one is cleared.
    body: changes.email === '' ? { ...changes, email: null } : changes,
    ifMatch,
    schema: subjectSchema,
  });
}

export function deleteSubject(
  gateway: Gateway,
  tenant: string,
  subjectId: string,
): Promise<GatewayResult<undefined>> {
  return adminCall(gateway, 'DELETE', tenant, ['subjects', subjectId], { schema: nothing });
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

export function readCredentials(
  gateway: Gateway,
  tenant: string,
  subjectId: string,
): Promise<GatewayResult<ListCredentialsResponse>> {
  return adminCall(gateway, 'GET', tenant, ['subjects', subjectId, 'credentials'], {
    schema: listCredentialsResponseSchema,
  });
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

export function readLockout(
  gateway: Gateway,
  tenant: string,
  subjectId: string,
): Promise<GatewayResult<Lockout>> {
  return adminCall(gateway, 'GET', tenant, ['subjects', subjectId, 'lockout'], {
    schema: lockoutSchema,
  });
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
  return result.ok ? { ...result, data: result.data.username_editable } : result;
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
