import { useClientLogout } from '#/pages/clients/use-cases/useClientLogout';
import { Deliveries } from '#/pages/clients/ui/Deliveries';
import type { ClientTabProps } from '#/pages/clients/ui/ClientTabProps';
import { Note } from '#/shared/ui/Note';
import { SaveSection } from '#/shared/ui/SaveSection';
import { ReadOnlyFields, ToggleField, UrlField, UrlListField } from '#/shared/ui/Field';
import { recordTab } from '#/shared/ui/RecordTab';

export function LogoutTab({ tenant, client, etag, gone, writable }: ClientTabProps) {
  const page = useClientLogout({ tenant, client, etag, gone });
  const { postLogout, confirmation, backchannel, frontchannel } = page;
  return (
    <div className={recordTab.tab}>
      <ReadOnlyFields when={!writable}>
        <SaveSection title={page.sections.postLogout} save={postLogout}>
          <UrlListField
            label="Post-logout redirect URIs"
            itemLabel="Post-logout redirect URI"
            description={page.postLogoutDescription}
            error={postLogout.fieldErrors.post_logout_redirect_uris}
            changed={postLogout.changed.includes('post_logout_redirect_uris')}
            value={postLogout.values.post_logout_redirect_uris}
            onChange={(value) => {
              postLogout.edit('post_logout_redirect_uris', value);
            }}
          />
        </SaveSection>
      </ReadOnlyFields>
      <ReadOnlyFields when={!writable || page.confirmationFixed !== null}>
        <SaveSection title={page.sections.confirmation} save={confirmation}>
          {page.confirmationFixed === null ? null : (
            <p className={recordTab.rule}>{page.confirmationFixed}</p>
          )}
          <ToggleField
            label={page.skipLogoutLabel}
            description={page.confirmationHint}
            describedBy={page.skipLogoutWarningId}
            value={confirmation.values.skip_logout_confirmation}
            changed={confirmation.changed.includes('skip_logout_confirmation')}
            onChange={(value) => {
              confirmation.edit('skip_logout_confirmation', value);
            }}
          />
          <Note
            id={page.skipLogoutWarningId}
            tone={
              confirmation.values.skip_logout_confirmation && page.confirmationFixed === null
                ? 'warning'
                : undefined
            }
          >
            {page.skipLogoutWarning}
          </Note>
        </SaveSection>
      </ReadOnlyFields>
      <ReadOnlyFields when={!writable}>
        <SaveSection
          title={page.sections.backchannel}
          description={page.backchannelRule}
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
            label={page.backchannelSessionLabel}
            description={page.backchannelSessionRule}
            value={backchannel.values.backchannel_logout_session_required}
            changed={backchannel.changed.includes('backchannel_logout_session_required')}
            onChange={(value) => {
              backchannel.edit('backchannel_logout_session_required', value);
            }}
          />
        </SaveSection>
        <SaveSection
          title={page.sections.frontchannel}
          description={page.frontchannelRule}
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
            label={page.frontchannelSessionLabel}
            description={page.frontchannelSessionRule}
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
