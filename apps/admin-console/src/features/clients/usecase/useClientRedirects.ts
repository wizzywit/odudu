import type { Client } from '@odudu/contracts/admin';
import { useRefusal } from '#/features/session';
import {
  useClientSaves,
  type OriginValues,
  type RedirectValues,
} from '#/features/clients/repository/useClientRecord.ts';
import {
  CLIENT_CAPABILITY,
  CLIENT_LIST_LIMIT,
  clientRecord,
  clientRefusal,
  FIELD,
  clientTabHref,
  listCount,
  listsReadOnly,
  redirectsFixed,
  SECTION,
} from '#/features/clients/service';
import { useSectionSave, type SectionSave } from '#/shared/repository/useSectionSave.ts';
import type { GatewayFailure } from '#/shared/transport/gateway.ts';

export interface ClientRedirects {
  redirects: SectionSave<RedirectValues>;
  redirectCount: string;
  origins: SectionSave<OriginValues>;
  originCount: string;
  // Why neither list can be changed, said in place of both.
  fixed: string | null;
  readOnly: boolean;
  // The post-logout URIs belong to the Logout tab.
  logoutHref: string;
}

export function useClientRedirects({
  tenant,
  client,
  etag,
  gone,
  writable,
}: {
  tenant: string;
  client: Client;
  etag: string;
  gone: boolean;
  writable: boolean;
}): ClientRedirects {
  const refusal = useRefusal(tenant);
  const saves = useClientSaves(tenant, client.id);
  const shared = {
    tenant,
    record: clientRecord(client.id),
    etag,
    capability: CLIENT_CAPABILITY,
    gone,
    onRefused: (failure: GatewayFailure) => {
      refusal.report(failure, CLIENT_CAPABILITY);
    },
    explain: clientRefusal,
  };

  const redirects = useSectionSave({
    ...shared,
    section: 'redirects',
    label: SECTION.redirects,
    fields: {
      redirect_uris: { value: client.redirect_uris, label: FIELD.redirectUris, kind: 'plain' },
    },
    save: saves.redirects,
  });
  const origins = useSectionSave({
    ...shared,
    section: 'origins',
    label: SECTION.origins,
    fields: {
      web_origins: { value: client.web_origins, label: FIELD.webOrigins, kind: 'plain' },
    },
    save: saves.origins,
  });

  return {
    redirects,
    redirectCount: listCount(redirects.values.redirect_uris, CLIENT_LIST_LIMIT, 'redirect URIs'),
    origins,
    originCount: listCount(origins.values.web_origins, CLIENT_LIST_LIMIT, 'web origins'),
    fixed: redirectsFixed(client),
    readOnly: listsReadOnly(client, writable),
    logoutHref: clientTabHref(tenant, client.id, 'logout'),
  };
}
