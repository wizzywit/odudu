import type { Tenant } from '#/pages/tenants/types/tenant';
import { findKey } from '#/shared/lib/repository/queryKeys';
import { createTenant, findTenant } from '#/pages/tenants/adapter/tenants';
import { createSubject, findSubject, issuePassword, type Subject } from '#/entities/subject';
import { defect, grantHoldings, refusedAt, type Refused } from '#/features/grant-administrator';
import { useSecretOnce, type SecretOnce } from '#/shared/lib/repository/useSecretOnce';
import type { Gateway, GatewayFailure, GatewayResult } from '#/shared/api/transport/gateway';
import { useFreshRead } from '#/shared/lib/repository/useFreshRead';
import { useWrite } from '#/shared/lib/repository/useWrite';
import { useTransport } from '#/shared/api/transport/useTransport';
import {
  administratorCalls,
  subjectlessRequest,
  type AdministratorCall,
  type AdministratorRequest,
} from '#/entities/administrator';

export interface TenantCreate {
  busy: boolean;
  create: (input: { name: string; displayName: string }) => Promise<GatewayResult<Tenant>>;
  find: (name: string) => Promise<GatewayResult<Tenant | null>>;
}

// Neither is repeated on its own: a POST whose answer was lost is looked
// for by name instead.
export function useTenantCreate(): TenantCreate {
  const { gateway } = useTransport();
  const create = useWrite({
    send: (gateway, input: { name: string; displayName: string }) => createTenant(gateway, input),
  });
  const fresh = useFreshRead();
  return {
    busy: create.busy || fresh.pending,
    create: create.run,
    find: (name) => fresh.read(findKey('tenants', name), () => findTenant(gateway, name)),
  };
}

export interface AdministratorRun {
  tenant: string;
  username: string;
  email: string;
  subjectId: string | null;
  granted: boolean;
  holdings: readonly string[];
  // Told as each call lands, so a reload between two resumes at the next.
  onProgress: (done: { subjectId: string; granted: boolean }) => void;
  // Told once of the call that failed, as it fails.
  onFailure: (
    failure: GatewayFailure,
    call: AdministratorCall,
    request: AdministratorRequest,
  ) => void;
}

type CallResult =
  { ok: true; subjectId?: string; password?: string } | { ok: false; refused: Refused };

async function runCall(
  gateway: Gateway,
  run: AdministratorRun,
  call: AdministratorCall,
  subjectId: string | null,
): Promise<CallResult> {
  if (call === 'create') {
    const created = await createSubject(gateway, run.tenant, run);
    return created.ok
      ? { ok: true, subjectId: created.data.id }
      : { ok: false, refused: refusedAt(created, 'create') };
  }
  if (subjectId === null) {
    return {
      ok: false,
      refused: refusedAt(
        defect('console defect: an administrator step ran with no subject'),
        subjectlessRequest(call),
      ),
    };
  }
  if (call === 'grant') {
    const refused = await grantHoldings(gateway, run.tenant, subjectId, run.holdings);
    return refused === null ? { ok: true } : { ok: false, refused };
  }
  const issued = await issuePassword(gateway, run.tenant, subjectId);
  return issued.ok
    ? { ok: true, password: issued.data.password }
    : { ok: false, refused: refusedAt(issued, 'password') };
}

async function runAdministrator(
  gateway: Gateway,
  run: AdministratorRun,
): Promise<GatewayResult<{ password: string }>> {
  let subjectId = run.subjectId;
  let granted = run.granted;
  for (const call of administratorCalls({ subjectId, granted })) {
    const result = await runCall(gateway, run, call, subjectId);
    if (!result.ok) {
      run.onFailure(result.refused.failure, call, result.refused.request);
      return result.refused.failure;
    }
    if (result.password !== undefined) {
      return { ok: true, status: 201, data: { password: result.password }, etag: null, next: null };
    }
    if (call === 'create') subjectId = result.subjectId ?? null;
    if (call === 'grant') granted = true;
    if (subjectId !== null) run.onProgress({ subjectId, granted });
  }
  const failure = defect('console defect: an administrator step issued no password');
  run.onFailure(failure, 'password', 'password');
  return failure;
}

// The subject, its grant and its one-time password, each one
// call, the password handed to its dialog alone.
export function useFirstAdministrator(): SecretOnce<AdministratorRun, null> {
  return useSecretOnce({
    run: runAdministrator,
    split: (answer: { password: string }) => ({ secret: answer.password, rest: null }),
  });
}

export function useFindSubject(): (
  tenant: string,
  username: string,
) => Promise<GatewayResult<Subject | null>> {
  const { gateway } = useTransport();
  const fresh = useFreshRead();
  return (tenant, username) =>
    fresh.read(findKey(tenant, 'subjects', username), () => findSubject(gateway, tenant, username));
}
