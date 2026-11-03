import {
  useClientSection,
  type ClientRecordRead,
} from '#/features/clients/use-cases/useClientSection';
import {
  useClientSaves,
  type OriginValues,
  type RedirectValues,
} from '#/features/clients/repository/useClientRecord';
import { listsReadOnly, redirectsFixed } from '#/features/clients/services/blocks';
import { FIELD, SECTION } from '#/features/clients/services/clientDetails';
import { CLIENT_LIST_LIMIT, listCount } from '#/features/clients/services/lists';
import { clientTabHref } from '#/features/clients/services/tabs';
import { useSectionSave, type SectionSave } from '#/shared/repository/useSectionSave';

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
}: ClientRecordRead & { writable: boolean }): ClientRedirects {
  const saves = useClientSaves(tenant, client.id);
  const shared = useClientSection({ tenant, client, etag, gone });

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
