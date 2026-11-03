import { Link } from 'react-aria-components';
import {
  ORIGINS_RULE,
  POST_LOGOUT_NOTE,
  REDIRECTS_RULE,
} from '#/pages/clients/services/clientRedirects';
import { useClientRedirects } from '#/pages/clients/use-cases/useClientRedirects';
import type { ClientTabProps } from '#/pages/clients/ui/ClientTabProps';
import { ReadOnlyFields, UrlListField } from '#/shared/ui/Field';
import { recordTab } from '#/shared/ui/RecordTab';
import { SaveSection } from '#/shared/ui/SaveSection';

export function RedirectsTab({ tenant, client, etag, gone, writable }: ClientTabProps) {
  const page = useClientRedirects({ tenant, client, etag, gone, writable });
  const redirects = page.redirects;
  const origins = page.origins;
  return (
    <div className={recordTab.tab}>
      {page.fixed === null ? null : <p className={recordTab.rule}>{page.fixed}</p>}
      <ReadOnlyFields when={page.readOnly}>
        <SaveSection title="Redirect URIs" save={redirects}>
          <UrlListField
            label="Redirect URIs"
            itemLabel="Redirect URI"
            description={`${REDIRECTS_RULE} ${page.redirectCount}`}
            error={redirects.fieldErrors.redirect_uris}
            changed={redirects.changed.includes('redirect_uris')}
            value={redirects.values.redirect_uris}
            onChange={(value) => {
              redirects.edit('redirect_uris', value);
            }}
          />
        </SaveSection>
        <SaveSection title="Web origins" save={origins}>
          <UrlListField
            label="Web origins"
            itemLabel="Web origin"
            description={`${ORIGINS_RULE} ${page.originCount}`}
            error={origins.fieldErrors.web_origins}
            changed={origins.changed.includes('web_origins')}
            value={origins.values.web_origins}
            onChange={(value) => {
              origins.edit('web_origins', value);
            }}
          />
        </SaveSection>
      </ReadOnlyFields>
      <p className={recordTab.rule}>
        {`${POST_LOGOUT_NOTE} `}
        <Link href={page.logoutHref}>Open Logout</Link>
      </p>
    </div>
  );
}
