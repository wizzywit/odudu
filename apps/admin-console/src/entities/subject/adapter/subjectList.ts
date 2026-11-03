import { listSubjectsResponseSchema } from '@odudu/contracts/admin';
import { countReader, listReader, mapResult } from '#/shared/api/adapter/route';
import type { ListPage } from '#/shared/lib/services/resourceList';
import type { Gateway, GatewayResult } from '#/shared/api/transport/gateway';
import { listedSubjectOf } from '#/entities/subject/adapter/subjectWire';
import type { ListedSubject } from '#/entities/subject/types/subject';

const readWirePage = listReader('subjects', listSubjectsResponseSchema);

export const readSubjectCount = countReader('subjects');

export async function readSubjectPage(
  gateway: Gateway,
  tenant: string,
  query: URLSearchParams,
): Promise<GatewayResult<ListPage<ListedSubject>>> {
  return mapResult(await readWirePage(gateway, tenant, query), ({ items, next }) => ({
    items: items.map(listedSubjectOf),
    next,
  }));
}
