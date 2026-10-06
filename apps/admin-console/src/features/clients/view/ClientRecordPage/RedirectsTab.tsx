import type { Client } from '@odudu/contracts/admin';
import { Link } from 'react-aria-components';
import { ORIGINS_RULE, POST_LOGOUT_NOTE, REDIRECTS_RULE } from '#/features/clients/service';
import { useClientRedirects } from '#/features/clients/usecase/useClientRedirects.ts';
import { SectionNoticeOf } from '#/shared/view/SectionNoticeOf';
import { ReadOnlyFields, UrlListField } from '#/shared/view/Field';
import { Section } from '#/shared/view/Section';
import styles from '#/features/clients/view/ClientRecordPage/Tab.module.css';

export function RedirectsTab({
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
}) {
  const page = useClientRedirects({ tenant, client, etag, gone, writable });
  const redirects = page.redirects;
  const origins = page.origins;
  return (
    <div className={styles.tab}>
      {page.fixed === null ? null : <p className={styles.rule}>{page.fixed}</p>}
      <ReadOnlyFields when={page.readOnly}>
        <Section
          title="Redirect URIs"
          dirty={redirects.dirty}
          saving={redirects.saving}
          onSave={redirects.submit}
          onDiscard={redirects.discard}
          restored={redirects.restored}
          blocked={redirects.blocked}
          notice={<SectionNoticeOf title="Redirect URIs" save={redirects} />}
        >
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
        </Section>
        <Section
          title="Web origins"
          dirty={origins.dirty}
          saving={origins.saving}
          onSave={origins.submit}
          onDiscard={origins.discard}
          restored={origins.restored}
          blocked={origins.blocked}
          notice={<SectionNoticeOf title="Web origins" save={origins} />}
        >
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
        </Section>
      </ReadOnlyFields>
      <p className={styles.rule}>
        {`${POST_LOGOUT_NOTE} `}
        <Link href={page.logoutHref}>Open Logout</Link>
      </p>
    </div>
  );
}
