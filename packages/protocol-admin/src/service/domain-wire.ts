import { type Domain } from '@odudu/contracts/admin';
import { challengeName, type DomainRow } from '@odudu/domain-tenant';
import { etagOf } from '#/service/etag';

export function domainWireShape(row: DomainRow): Domain {
  return {
    id: row.id,
    host: row.host,
    state: row.state,
    canonical: row.canonical,
    verified_at: row.verifiedAt?.toISOString() ?? null,
    last_checked_at: row.lastCheckedAt?.toISOString() ?? null,
    dns_record:
      row.state === 'pending' ? { name: challengeName(row.host), value: row.challenge } : null,
  };
}

// The validator every domains response carries and an activate or deactivate
// may name in `If-Match`: which domain, if any, is the tenant's address. A
// switch changes it and nothing else a domains call does does.
export function switchEtag(canonical: DomainRow | null): string {
  return etagOf({ canonical: canonical?.id ?? null });
}
