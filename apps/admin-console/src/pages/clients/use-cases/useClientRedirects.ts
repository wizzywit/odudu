import {
  useClientSection,
  type ClientRecordRead,
} from '#/pages/clients/use-cases/useClientSection';
import {
  useClientSaves,
  type OriginValues,
  type RedirectValues,
} from '#/pages/clients/repository/useClientRecord';
import { listsReadOnly, redirectsFixed } from '#/pages/clients/services/builtinFixed';
import { FIELD, SECTION } from '#/pages/clients/services/clientDetails';
import {
  ORIGINS_RULE,
  POST_LOGOUT_NOTE,
  REDIRECTS_RULE,
} from '#/pages/clients/services/clientRedirects';
import { CLIENT_LIST_LIMIT, listCount } from '#/pages/clients/services/listEntries';
import { clientHref } from '#/entities/client';
import { clientTabHrefOf } from '#/pages/clients/services/tabs';
import { useSectionSave, type SectionSave } from '#/shared/repository/useSectionSave';

export interface ClientRedirects {
  redirects: SectionSave<RedirectValues>;
  // The rule for redirect URIs, with how many are listed.
  redirectsDescription: string;
  origins: SectionSave<OriginValues>;
  originsDescription: string;
  // Why neither list can be changed, said in place of both.
  fixed: string | null;
  readOnly: boolean;
  // The post-logout URIs belong to the Logout tab.
  logoutHref: string;
  logoutNote: string;
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
    redirectsDescription: `${REDIRECTS_RULE} ${listCount(redirects.values.redirect_uris, CLIENT_LIST_LIMIT, 'redirect URIs')}`,
    origins,
    originsDescription: `${ORIGINS_RULE} ${listCount(origins.values.web_origins, CLIENT_LIST_LIMIT, 'web origins')}`,
    fixed: redirectsFixed(client),
    readOnly: listsReadOnly(client, writable),
    logoutHref: clientTabHrefOf(clientHref)(tenant, client.id, 'logout'),
    logoutNote: POST_LOGOUT_NOTE,
  };
}
