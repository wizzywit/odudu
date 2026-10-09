import type { Client } from '@odudu/contracts/admin';
import {
  BACKCHANNEL_RULE,
  BACKCHANNEL_SESSION_LABEL,
  BACKCHANNEL_SESSION_RULE,
  FRONTCHANNEL_RULE,
  FRONTCHANNEL_SESSION_LABEL,
  FRONTCHANNEL_SESSION_RULE,
  POST_LOGOUT_RULE,
  SECTIONS_LOGOUT,
} from '#/features/clients/service';
import { useClientLogout } from '#/features/clients/usecase/useClientLogout.ts';
import { Deliveries } from '#/features/clients/view/Deliveries';
import { SaveSection } from '#/features/clients/view/SaveSection';
import { ReadOnlyFields, ToggleField, UrlField, UrlListField } from '#/shared/view/Field';
import styles from '#/features/clients/view/LogoutTab/LogoutTab.module.css';

export function LogoutTab({
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
  const page = useClientLogout({ tenant, client, etag, gone });
  const { postLogout, backchannel, frontchannel } = page;
  return (
    <div className={styles.tab}>
      <ReadOnlyFields when={!writable}>
        <SaveSection title={SECTIONS_LOGOUT.postLogout} save={postLogout}>
          <UrlListField
            label="Post-logout redirect URIs"
            itemLabel="Post-logout redirect URI"
            description={`${POST_LOGOUT_RULE} ${page.postLogoutCount}`}
            error={postLogout.fieldErrors.post_logout_redirect_uris}
            changed={postLogout.changed.includes('post_logout_redirect_uris')}
            value={postLogout.values.post_logout_redirect_uris}
            onChange={(value) => {
              postLogout.edit('post_logout_redirect_uris', value);
            }}
          />
        </SaveSection>
        <SaveSection
          title={SECTIONS_LOGOUT.backchannel}
          description={BACKCHANNEL_RULE}
          save={backchannel}
        >
          <UrlField
            label="Back-channel logout address"
            autoComplete="off"
            value={backchannel.values.backchannel_logout_uri}
            error={backchannel.fieldErrors.backchannel_logout_uri}
            changed={backchannel.changed.includes('backchannel_logout_uri')}
            onChange={(value) => {
              backchannel.edit('backchannel_logout_uri', value);
            }}
          />
          <ToggleField
            label={BACKCHANNEL_SESSION_LABEL}
            description={BACKCHANNEL_SESSION_RULE}
            value={backchannel.values.backchannel_logout_session_required}
            changed={backchannel.changed.includes('backchannel_logout_session_required')}
            onChange={(value) => {
              backchannel.edit('backchannel_logout_session_required', value);
            }}
          />
        </SaveSection>
        <SaveSection
          title={SECTIONS_LOGOUT.frontchannel}
          description={FRONTCHANNEL_RULE}
          save={frontchannel}
        >
          <UrlField
            label="Front-channel logout address"
            autoComplete="off"
            value={frontchannel.values.frontchannel_logout_uri}
            error={frontchannel.fieldErrors.frontchannel_logout_uri}
            changed={frontchannel.changed.includes('frontchannel_logout_uri')}
            onChange={(value) => {
              frontchannel.edit('frontchannel_logout_uri', value);
            }}
          />
          <ToggleField
            label={FRONTCHANNEL_SESSION_LABEL}
            description={FRONTCHANNEL_SESSION_RULE}
            value={frontchannel.values.frontchannel_logout_session_required}
            changed={frontchannel.changed.includes('frontchannel_logout_session_required')}
            onChange={(value) => {
              frontchannel.edit('frontchannel_logout_session_required', value);
            }}
          />
        </SaveSection>
      </ReadOnlyFields>
      <Deliveries tenant={tenant} client={client} />
    </div>
  );
}
