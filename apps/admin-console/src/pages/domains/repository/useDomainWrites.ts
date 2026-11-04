import type { Domain } from '#/pages/domains/types/domain';
import { useRef } from 'react';
import {
  activateDomain,
  deactivateDomain,
  registerDomain,
  removeDomain,
  verifyDomain,
} from '#/pages/domains/adapter/domains';
import { DOMAINS_RECORD } from '#/pages/domains/services/domainsWords';
import { passkeyImpactsKey } from '#/pages/domains/repository/queryKeys';
import { overviewKey, recordKey } from '#/shared/lib/repository/queryKeys';
import { useInvalidate } from '#/shared/lib/repository/useInvalidate';
import { useGatewayWrite, type Write } from '#/shared/lib/repository/useWrite';
import type { Gateway, GatewayResult } from '#/shared/api/transport/gateway';

// A write's answer changes the domains, the tag a switch waits on, what a
// switch would do to passkeys and what the overview says of the address,
// whatever it was: a refused or lost write may still have left them stale.
function useDomainsRead(tenant: string): () => void {
  const { invalidate, invalidateExact } = useInvalidate();
  return () => {
    invalidateExact(recordKey(tenant, DOMAINS_RECORD));
    invalidate(overviewKey(tenant), passkeyImpactsKey(tenant));
  };
}

type DomainWrite<Input, Answer> = Write<Input, GatewayResult<Answer>>;

function useDomainWrite<Input, Answer>(
  tenant: string,
  send: (gateway: Gateway, input: Input) => Promise<GatewayResult<Answer>>,
): DomainWrite<Input, Answer> {
  const read = useDomainsRead(tenant);
  // One press is one write, however often it is pressed before the first answer.
  const sending = useRef(false);
  const write = useGatewayWrite({
    send,
    onSettled: () => {
      sending.current = false;
      read();
    },
  });
  return {
    busy: write.busy,
    run: (input) => {
      if (sending.current) return Promise.resolve({ ok: false, kind: 'defect' });
      sending.current = true;
      return write.run(input);
    },
  };
}

// A switch names the tag it was asked for against, the tenant's, never a domain's.
export interface Switch {
  id: string;
  ifMatch: string;
}

export function useRegisterDomain(tenant: string): DomainWrite<string, Domain> {
  return useDomainWrite(tenant, (gateway, host) => registerDomain(gateway, tenant, host));
}

export function useVerifyDomain(tenant: string): DomainWrite<string, Domain> {
  return useDomainWrite(tenant, (gateway, id) => verifyDomain(gateway, tenant, id));
}

export function useActivateDomain(tenant: string): DomainWrite<Switch, Domain> {
  return useDomainWrite(tenant, (gateway, { id, ifMatch }) =>
    activateDomain(gateway, tenant, id, ifMatch),
  );
}

export function useDeactivateDomain(tenant: string): DomainWrite<Switch, Domain> {
  return useDomainWrite(tenant, (gateway, { id, ifMatch }) =>
    deactivateDomain(gateway, tenant, id, ifMatch),
  );
}

export function useRemoveDomain(tenant: string): DomainWrite<Pick<Switch, 'id'>, undefined> {
  return useDomainWrite(tenant, (gateway, { id }) => removeDomain(gateway, tenant, id));
}
