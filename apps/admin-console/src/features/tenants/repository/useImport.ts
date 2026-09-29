import type { Tenant } from '@odudu/contracts/admin';
import { useMutation } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { readFileText } from '#/features/tenants/adapter/files.ts';
import { findTenant, importTenant } from '#/features/tenants/adapter/tenants.ts';
import { parseDocument } from '#/features/tenants/service.ts';
import type { GatewayFailure, GatewayResult } from '#/shared/transport/gateway.ts';
import { useTransport } from '#/shared/transport/useTransport.ts';

export interface ImportInput {
  readonly name: string;
  readonly displayName: string;
  readonly file: File;
}

export interface ImportedSecret {
  readonly clientId: string;
  readonly secret: string;
}

export type ImportOutcome =
  | { readonly ok: true; readonly tenant: Tenant; readonly secrets: number }
  | { readonly ok: false; readonly kind: 'file'; readonly message: string }
  | { readonly ok: false; readonly kind: 'refused'; readonly failure: GatewayFailure };

export interface TenantImport {
  // Never sent twice for one press: a repeat would answer 409 and the
  // secrets of the first would be lost.
  readonly start: (input: ImportInput) => void;
  readonly busy: boolean;
  readonly outcome: ImportOutcome | null;
  // One client's secret at a time, for its SecretDialog and nothing else.
  readonly secret: ImportedSecret | null;
  readonly shown: number;
  readonly close: () => void;
  readonly find: (name: string) => Promise<GatewayResult<Tenant | null>>;
}

// The secrets are split off before the mutation settles, so the mutation
// cache holds only the tenant and how many there were.
export function useImport(onRefused: (failure: GatewayFailure) => void): TenantImport {
  const { gateway } = useTransport();
  const [secrets, setSecrets] = useState<readonly ImportedSecret[]>([]);
  const [shown, setShown] = useState(0);
  const inFlight = useRef(false);
  const mutation = useMutation({
    mutationFn: async (input: ImportInput): Promise<ImportOutcome> => {
      const document = parseDocument(await readFileText(input.file));
      if (!document.ok) return { ok: false, kind: 'file', message: document.message };
      const result = await importTenant(gateway, { ...input, document: document.document });
      if (!result.ok) {
        onRefused(result);
        return { ok: false, kind: 'refused', failure: result };
      }
      setShown(0);
      setSecrets(
        result.data.client_secrets.map(({ client_id, secret }) => ({
          clientId: client_id,
          secret,
        })),
      );
      return { ok: true, tenant: result.data.tenant, secrets: result.data.client_secrets.length };
    },
    onSettled: () => {
      inFlight.current = false;
    },
  });
  const find = useMutation({ mutationFn: (name: string) => findTenant(gateway, name) });
  return {
    start: (input) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setSecrets([]);
      mutation.mutate(input);
    },
    busy: mutation.isPending,
    outcome: mutation.data ?? null,
    secret: secrets[0] ?? null,
    shown,
    close: () => {
      setShown((count) => count + 1);
      setSecrets((left) => left.slice(1));
    },
    find: (name) => find.mutateAsync(name),
  };
}
