import {
  listTermsAcceptancesResponseSchema,
  type TermsAcceptance as WireAcceptance,
} from '@odudu/contracts/admin';
import type { ListPage } from '#/shared/lib/services/resourceList';
import type { Gateway, GatewayResult } from '#/shared/api/transport/gateway';
import { adminCall, mapResult } from '#/shared/api/adapter/route';
import { type TermsAcceptance } from '#/pages/subjects/types/termsAcceptance';

function acceptanceOf(wire: WireAcceptance): TermsAcceptance {
  return { version: wire.version, acceptedAt: wire.accepted_at };
}

export async function readTermsAcceptances(
  gateway: Gateway,
  tenant: string,
  subjectId: string,
  query: URLSearchParams,
): Promise<GatewayResult<ListPage<TermsAcceptance>>> {
  const result = await adminCall(
    gateway,
    'GET',
    tenant,
    ['subjects', subjectId, 'terms-acceptances'],
    { query, schema: listTermsAcceptancesResponseSchema },
  );
  return mapResult(result, ({ items, next }) => ({ items: items.map(acceptanceOf), next }));
}
