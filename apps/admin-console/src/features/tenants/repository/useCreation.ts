import type { Subject, Tenant } from '@odudu/contracts/admin';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
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
  return {
    creation,
    update: (next) => {
      storeCreation(owner, next);
      setCreation(next);
    },
  };
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
  readonly onFailure: (failure: GatewayFailure, call: AdministratorCall) => void;
}

function defect(message: string): GatewayFailure {
  console.error(message);
  return { ok: false, kind: 'defect' };
}

async function grantTenantAdmin(
  gateway: Gateway,
  tenant: string,
  subjectId: string,
): Promise<GatewayResult<unknown>> {
  const clients = await readAdminClients(gateway, tenant);
  if (!clients.ok) return clients;
  const client = builtinAdminClient(clients.data.items);
  if (client === null)
    return defect(`console defect: ${tenant} lists no built-in odudu-admin client`);
  const roles = await readClientRoles(gateway, tenant, client, TENANT_ADMIN);
  if (!roles.ok) return roles;
  const role = tenantAdminRole(roles.data.items, client);
  if (role === null)
    return defect(`console defect: ${tenant}'s odudu-admin has no ${TENANT_ADMIN}`);
  const held = await readSubjectRoles(gateway, tenant, subjectId);
  if (!held.ok) return held;
  if (held.etag === null)
    return defect(`console defect: ${tenant} answered a subject's roles without an ETag`);
  const ids = held.data.items.map((assigned) => assigned.id);
  return setSubjectRoles(gateway, tenant, subjectId, withRole(ids, role), held.etag);
}

async function runCall(
  gateway: Gateway,
  run: AdministratorRun,
  call: AdministratorCall,
  subjectId: string | null,
): Promise<GatewayResult<{ readonly subjectId?: string; readonly password?: string }>> {
  if (call === 'create') {
    const created = await createSubject(gateway, run.tenant, run);
    return created.ok ? { ...created, data: { subjectId: created.data.id } } : created;
  }
  if (subjectId === null)
    return defect('console defect: an administrator step ran with no subject');
  if (call === 'grant') {
    const granted = await grantTenantAdmin(gateway, run.tenant, subjectId);
    return granted.ok ? { ...granted, data: {} } : granted;
  }
  return issuePassword(gateway, run.tenant, subjectId);
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
      run.onFailure(result, call);
      return result;
    }
    if (result.data.password !== undefined)
      return { ...result, data: { password: result.data.password } };
    if (call === 'create') subjectId = result.data.subjectId ?? null;
    if (call === 'grant') granted = true;
    if (subjectId !== null) run.onProgress({ subjectId, granted });
  }
  const failure = defect('console defect: an administrator step issued no password');
  run.onFailure(failure, 'password');
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
