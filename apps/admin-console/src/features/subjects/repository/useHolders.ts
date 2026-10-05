import type { Subject } from '@odudu/contracts/admin';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { readSubjectPage } from '#/features/subjects/adapter/subjects.ts';
import { holdingsIn, type Holding } from '#/shared/service/capabilities.ts';
import type { Gateway, GatewayFailure, GatewayResult } from '#/shared/transport/gateway.ts';
import { useTransport } from '#/shared/transport/useTransport.ts';

// Administrators are few, so each holding's holders are read whole, page
// after page, rather than offered a page at a time.
async function readEvery(
  gateway: Gateway,
  tenant: string,
  holding: Holding,
): Promise<GatewayResult<Subject[]>> {
  const found: Subject[] = [];
  let cursor: string | undefined;
  do {
    const query = new URLSearchParams({ capability: holding, limit: '200' });
    if (cursor !== undefined) query.set('cursor', cursor);
    const page = await readSubjectPage(gateway, tenant, query);
    if (!page.ok) return page;
    found.push(...page.data.items);
    cursor = page.data.next;
  } while (cursor !== undefined);
  return { ok: true, status: 200, data: found, etag: null, next: null };
}

export type HolderLists =
  | { status: 'loading' }
  | { status: 'ready'; byHolding: ReadonlyMap<Holding, readonly Subject[]> }
  | { status: 'failed'; failure: GatewayFailure; retry: () => void };

// Every subject holding each admin capability, effectively: directly,
// through a group, or nested under another role.
export function useHolderLists(tenant: string): HolderLists {
  const { gateway } = useTransport();
  const client = useQueryClient();
  const holdings = holdingsIn(tenant);
  const reads = useQueries({
    queries: holdings.map((holding) => ({
      queryKey: ['holders', tenant, holding],
      queryFn: () => readEvery(gateway, tenant, holding),
    })),
  });
  const byHolding = new Map<Holding, readonly Subject[]>();
  for (const [i, read] of reads.entries()) {
    const holding = holdings[i];
    const result = read.data;
    if (holding === undefined) continue;
    if (result === undefined) return { status: 'loading' };
    if (!result.ok) {
      return {
        status: 'failed',
        failure: result,
        retry: () => {
          client.invalidateQueries({ queryKey: ['holders', tenant] }).catch(() => undefined);
        },
      };
    }
    byHolding.set(holding, result.data);
  }
  return { status: 'ready', byHolding };
}
