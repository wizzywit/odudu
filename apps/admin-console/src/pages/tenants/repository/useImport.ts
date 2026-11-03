import type { Tenant } from '#/pages/tenants/types/tenant';
import { findKey } from '#/shared/repository/queryKeys';
import { useMutation } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { readFileText } from '#/pages/tenants/adapter/files';
import { findTenant, importTenant } from '#/pages/tenants/adapter/tenants';
import { parseDocument } from '#/pages/tenants/services/document';
import { type ImportedSecret, type ImportOutcome } from '#/pages/tenants/services/import';
import type { GatewayFailure, GatewayResult } from '#/shared/transport/gateway';
import { useFreshRead } from '#/shared/repository/useFreshRead';
import { useTransport } from '#/shared/transport/useTransport';

export interface ImportInput {
  name: string;
  displayName: string;
  file: File;
}

export interface TenantImport {
  // Never sent twice for one press: a repeat would answer 409 and the
  // secrets of the first would be lost.
  start: (input: ImportInput) => void;
  busy: boolean;
  outcome: ImportOutcome | null;
  // One client's secret at a time, for its SecretDialog and nothing else.
  secret: ImportedSecret | null;
  shown: number;
  close: () => void;
  find: (name: string) => Promise<GatewayResult<Tenant | null>>;
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
      setSecrets(result.data.secrets);
      return { ok: true, tenant: result.data.tenant, secrets: result.data.secrets.length };
    },
    onSettled: () => {
      inFlight.current = false;
    },
  });
  const fresh = useFreshRead();
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
    find: (name) => fresh.read(findKey('tenants', name), () => findTenant(gateway, name)),
  };
}
