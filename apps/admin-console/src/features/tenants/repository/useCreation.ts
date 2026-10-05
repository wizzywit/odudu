import type { Subject, Tenant } from '@odudu/contracts/admin';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { loadCreation, storeCreation } from '#/features/tenants/adapter/creationStorage.ts';
import { createTenant, findTenant } from '#/features/tenants/adapter/tenants.ts';
import {
  administratorOf,
  belongsTo,
  flowOf,
  freshCreation,
  type Creation,
  type CreationFlow,
} from '#/features/tenants/service.ts';
import { createSubject, findSubject, issuePassword } from '#/shared/adapter/administrators.ts';
import {
  defect,
  grantHoldings,
  refusedAt,
  type Refused,
} from '#/shared/repository/administratorRoles.ts';
import {
  administratorCalls,
  type AdministratorCall,
  type AdministratorRequest,
} from '#/shared/service/administrators.ts';
import { useSecretOnce, type SecretOnce } from '#/shared/repository/useSecretOnce.ts';
import type { Gateway, GatewayFailure, GatewayResult } from '#/shared/transport/gateway.ts';
import { useFreshRead } from '#/shared/repository/useFreshRead.ts';
import { useTransport } from '#/shared/transport/useTransport.ts';

export interface CreationProgress {
  creation: Creation;
  update: (creation: Creation) => void;
}

function ownCreation(owner: string, flow: CreationFlow): Creation | null {
  const stored = loadCreation(owner, flow);
  return stored !== null && belongsTo(flow, stored) ? stored : null;
}

// Kept in this tab's storage on every change, so a reload resumes it.
export function useCreationProgress(owner: string, flow: CreationFlow): CreationProgress {
  const [creation, setCreation] = useState<Creation>(
    () => ownCreation(owner, flow) ?? freshCreation(flow),
  );
  // A finished creation survives a reload, which runs no cleanup, but not
  // leaving the page: the next "Create a tenant" starts a new one.
  useEffect(() => {
    if (creation.step !== 'done') return undefined;
    storeCreation(owner, creation, flow);
    return () => {
      if (ownCreation(owner, flow)?.step === 'done') storeCreation(owner, null, flow);
    };
  }, [owner, flow, creation]);
  return {
    creation,
    update: (next) => {
      storeCreation(owner, next, flow);
      setCreation(next);
    },
  };
}

export function storedCreation(owner: string, tenant: string): Creation | null {
  return ownCreation(owner, flowOf(tenant));
}

export function beginAdministrator(
  owner: string,
  tenant: string,
  origin: 'created' | 'imported' | 'existing',
): void {
  storeCreation(owner, administratorOf(tenant, origin), flowOf(tenant));
}

export interface TenantCreate {
  busy: boolean;
  create: (input: { name: string; displayName: string }) => Promise<GatewayResult<Tenant>>;
  find: (name: string) => Promise<GatewayResult<Tenant | null>>;
}

// Neither is repeated on its own: a POST whose answer was lost is looked
// for by name instead.
export function useTenantCreate(): TenantCreate {
  const { gateway } = useTransport();
  const create = useMutation({
    mutationFn: (input: { name: string; displayName: string }) => createTenant(gateway, input),
  });
  const fresh = useFreshRead();
  return {
    busy: create.isPending || fresh.pending,
    create: (input) => create.mutateAsync(input),
    find: (name) => fresh.read(['find', 'tenants', name], () => findTenant(gateway, name)),
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
        call === 'grant' ? 'set-roles' : 'password',
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
    fresh.read(['find', tenant, 'subjects', username], () =>
      findSubject(gateway, tenant, username),
    );
}
