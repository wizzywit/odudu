import type { Subject, Tenant } from '@odudu/contracts/admin';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
  createSubject,
  findSubject,
  issuePassword,
  readAdminClients,
  readClientRoles,
  readSubjectRoles,
  setSubjectRoles,
} from '#/features/tenants/adapter/administrators.ts';
import { loadCreation, storeCreation } from '#/features/tenants/adapter/creationStorage.ts';
import { createTenant, findTenant } from '#/features/tenants/adapter/tenants.ts';
import {
  administratorCalls,
  administratorOf,
  type AdministratorCall,
  type AdministratorRequest,
  builtinAdminClient,
  FRESH_CREATION,
  TENANT_ADMIN,
  tenantAdminRole,
  withRole,
  type Creation,
} from '#/features/tenants/service.ts';
import { useSecretOnce, type SecretOnce } from '#/shared/repository/useSecretOnce.ts';
import type { Gateway, GatewayFailure, GatewayResult } from '#/shared/transport/gateway.ts';
import { useTransport } from '#/shared/transport/useTransport.ts';

export interface CreationProgress {
  readonly creation: Creation;
  readonly update: (creation: Creation) => void;
}

// Kept in this tab's storage on every change, so a reload resumes it.
export function useCreationProgress(owner: string): CreationProgress {
  const [creation, setCreation] = useState<Creation>(() => loadCreation(owner) ?? FRESH_CREATION);
  // A finished creation survives a reload, which runs no cleanup, but not
  // leaving the page: the next "Create a tenant" starts a new one.
  useEffect(() => {
    if (creation.step !== 'done') return undefined;
    storeCreation(owner, creation);
    return () => {
      if (loadCreation(owner)?.step === 'done') storeCreation(owner, null);
    };
  }, [owner, creation]);
  return {
    creation,
    update: (next) => {
      storeCreation(owner, next);
      setCreation(next);
    },
  };
}

export function storedCreation(owner: string): Creation | null {
  return loadCreation(owner);
}

export function beginAdministrator(
  owner: string,
  tenant: string,
  origin: 'created' | 'imported' | 'existing',
): void {
  storeCreation(owner, administratorOf(tenant, origin));
}

export interface TenantCreate {
  readonly busy: boolean;
  readonly create: (input: {
    readonly name: string;
    readonly displayName: string;
  }) => Promise<GatewayResult<Tenant>>;
  readonly find: (name: string) => Promise<GatewayResult<Tenant | null>>;
}

// Neither is repeated on its own: a POST whose answer was lost is looked
// for by name instead.
export function useTenantCreate(): TenantCreate {
  const { gateway } = useTransport();
  const create = useMutation({
    mutationFn: (input: { readonly name: string; readonly displayName: string }) =>
      createTenant(gateway, input),
  });
  const find = useMutation({ mutationFn: (name: string) => findTenant(gateway, name) });
  return {
    busy: create.isPending || find.isPending,
    create: (input) => create.mutateAsync(input),
    find: (name) => find.mutateAsync(name),
  };
}

export interface AdministratorRun {
  readonly tenant: string;
  readonly username: string;
  readonly email: string;
  readonly subjectId: string | null;
  readonly granted: boolean;
  // Told as each call lands, so a reload between two resumes at the next.
  readonly onProgress: (done: { readonly subjectId: string; readonly granted: boolean }) => void;
  // Told once of the call that failed, as it fails.
  readonly onFailure: (
    failure: GatewayFailure,
    call: AdministratorCall,
    request: AdministratorRequest,
  ) => void;
}

function defect(message: string): GatewayFailure {
  console.error(message);
  return { ok: false, kind: 'defect' };
}

interface Refused {
  readonly failure: GatewayFailure;
  readonly request: AdministratorRequest;
}

function refusedAt(failure: GatewayFailure, request: AdministratorRequest): Refused {
  return { failure, request };
}

async function grantTenantAdmin(
  gateway: Gateway,
  tenant: string,
  subjectId: string,
): Promise<Refused | null> {
  const clients = await readAdminClients(gateway, tenant);
  if (!clients.ok) return refusedAt(clients, 'clients');
  const client = builtinAdminClient(clients.data.items);
  if (client === null) {
    return refusedAt(
      defect(`console defect: ${tenant} lists no built-in odudu-admin client`),
      'clients',
    );
  }
  const roles = await readClientRoles(gateway, tenant, client, TENANT_ADMIN);
  if (!roles.ok) return refusedAt(roles, 'roles');
  const role = tenantAdminRole(roles.data.items, client);
  if (role === null) {
    return refusedAt(
      defect(`console defect: ${tenant}'s odudu-admin has no ${TENANT_ADMIN}`),
      'roles',
    );
  }
  const held = await readSubjectRoles(gateway, tenant, subjectId);
  if (!held.ok) return refusedAt(held, 'subject-roles');
  if (held.etag === null) {
    return refusedAt(
      defect(`console defect: ${tenant} answered a subject's roles without an ETag`),
      'subject-roles',
    );
  }
  const ids = held.data.items.map((assigned) => assigned.id);
  const set = await setSubjectRoles(gateway, tenant, subjectId, withRole(ids, role), held.etag);
  return set.ok ? null : refusedAt(set, 'set-roles');
}

type CallResult =
  | { readonly ok: true; readonly subjectId?: string; readonly password?: string }
  | { readonly ok: false; readonly refused: Refused };

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
    const refused = await grantTenantAdmin(gateway, run.tenant, subjectId);
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
): Promise<GatewayResult<{ readonly password: string }>> {
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

// The subject, its tenant-admin grant and its one-time password, each one
// call, the password handed to its dialog alone.
export function useFirstAdministrator(): SecretOnce<AdministratorRun, null> {
  return useSecretOnce({
    run: runAdministrator,
    split: (answer: { readonly password: string }) => ({ secret: answer.password, rest: null }),
  });
}

export function useFindSubject(): (
  tenant: string,
  username: string,
) => Promise<GatewayResult<Subject | null>> {
  const { gateway } = useTransport();
  const find = useMutation({
    mutationFn: (input: { readonly tenant: string; readonly username: string }) =>
      findSubject(gateway, input.tenant, input.username),
  });
  return (tenant, username) => find.mutateAsync({ tenant, username });
}
