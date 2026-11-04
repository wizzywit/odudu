import type { Domain, DomainDnsRecord, ListDomainsResponse } from '#/pages/domains/types/domain';

export type DomainAction = 'verify' | 'activate' | 'deactivate' | 'remove';

export interface DomainRow {
  domain: Domain;
  tag: { tone: 'active' | 'warning' | 'danger'; label: string };
  // Whether it is the tenant's address now, or a verified domain left idle.
  use: 'Current address' | 'Not in use' | null;
  actions: readonly DomainAction[];
  // What each action is called to a screen reader, by the host it acts on.
  labels: Record<DomainAction, string>;
}

export interface Challenge {
  id: string;
  host: string;
  record: DomainDnsRecord;
}

const TAGS: Record<Domain['state'], DomainRow['tag']> = {
  pending: { tone: 'warning', label: 'Pending' },
  verified: { tone: 'active', label: 'Verified' },
  failed: { tone: 'danger', label: 'Failed' },
};

// The address can always be switched back from, whatever state its domain is
// in, and is never removed while it is the address.
function actionsOf(domain: Domain): readonly DomainAction[] {
  if (domain.canonical) return ['deactivate'];
  if (domain.state === 'verified') return ['activate', 'remove'];
  return ['verify', 'remove'];
}

function useOf(domain: Domain): DomainRow['use'] {
  if (domain.canonical) return 'Current address';
  return domain.state === 'verified' ? 'Not in use' : null;
}

export function domainRows(domains: readonly Domain[]): DomainRow[] {
  return domains.map((domain) => ({
    domain,
    tag: TAGS[domain.state],
    use: useOf(domain),
    actions: actionsOf(domain),
    labels: {
      verify: `Verify ${domain.host}`,
      activate: `Make ${domain.host} the address`,
      deactivate: `Switch back from ${domain.host}`,
      remove: `Remove ${domain.host}`,
    },
  }));
}

export function addressLine(domains: readonly Domain[]): string {
  const address = domains.find((domain) => domain.canonical);
  return address === undefined
    ? 'This tenant signs in at its path address.'
    : `This tenant signs in at ${address.host}.`;
}

// Only a pending domain still has a record to publish; a failed one's
// record is the one it was given, which the console no longer holds.
export function challengesOf(domains: readonly Domain[]): Challenge[] {
  return domains.flatMap((domain) =>
    domain.dns_record === null
      ? []
      : [{ id: domain.id, host: domain.host, record: domain.dns_record }],
  );
}

// What the first read holds, or nothing before it has answered.
export function domainsOf(page: ListDomainsResponse | undefined): readonly Domain[] {
  return page?.items ?? [];
}

export type ColumnId = 'host' | 'state' | 'use' | 'checked' | 'actions';

// The actions are left out for a caller who may only look.
export function columnIds(viewOnly: boolean): readonly ColumnId[] {
  const shown: readonly ColumnId[] = ['host', 'state', 'use', 'checked'];
  return viewOnly ? shown : [...shown, 'actions'];
}

// Every action is made against the tenant's tag, so none is offered before it
// is read; a verification already running is not started a second time.
export function actionDisabled(
  action: DomainAction,
  state: { tagged: boolean; verifying: boolean },
): boolean {
  return !state.tagged || (action === 'verify' && state.verifying);
}
