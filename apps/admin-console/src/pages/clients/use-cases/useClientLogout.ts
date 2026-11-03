import {
  useClientConfigSaves,
  type BackchannelValues,
  type ConfirmationValues,
  type FrontchannelValues,
  type PostLogoutValues,
} from '#/pages/clients/repository/useClientConfigSaves';
import { skipLogoutFixed } from '#/pages/clients/services/builtinFixed';
import { CLIENT_LIST_LIMIT, listCount } from '#/pages/clients/services/listEntries';
import {
  BACKCHANNEL_RULE,
  BACKCHANNEL_SESSION_LABEL,
  BACKCHANNEL_SESSION_RULE,
  FRONTCHANNEL_RULE,
  FRONTCHANNEL_SESSION_LABEL,
  FRONTCHANNEL_SESSION_RULE,
  LOGOUT_FIELD,
  POST_LOGOUT_NOUN,
  POST_LOGOUT_RULE,
  skipLogoutHint,
  SKIP_LOGOUT_LABEL,
  SKIP_LOGOUT_WARNING,
  SKIP_LOGOUT_WARNING_ID,
} from '#/pages/clients/services/logoutSettings';
import { SECTIONS_LOGOUT } from '#/pages/clients/services/sectionTitles';
import {
  useClientSection,
  type ClientRecordRead,
} from '#/pages/clients/use-cases/useClientSection';
import { useSectionSave, type SectionSave } from '#/shared/repository/useSectionSave';
import { orBlank, spaced } from '#/shared/services/format';

export interface ClientLogout {
  sections: typeof SECTIONS_LOGOUT;
  postLogout: SectionSave<PostLogoutValues>;
  // The rule for post-logout redirect URIs, with how many are listed.
  postLogoutDescription: string;
  skipLogoutLabel: string;
  // The id of the warning the toggle is described by, and the warning.
  skipLogoutWarningId: string;
  skipLogoutWarning: string;
  backchannelRule: string;
  backchannelSessionLabel: string;
  backchannelSessionRule: string;
  frontchannelRule: string;
  frontchannelSessionLabel: string;
  frontchannelSessionRule: string;
  confirmation: SectionSave<ConfirmationValues>;
  // Why the setting cannot be changed on this client, or null where it can.
  confirmationFixed: string | null;
  confirmationHint: string | undefined;
  backchannel: SectionSave<BackchannelValues>;
  frontchannel: SectionSave<FrontchannelValues>;
}

export function useClientLogout(args: ClientRecordRead): ClientLogout {
  const { client } = args;
  const shared = useClientSection(args);
  const saves = useClientConfigSaves(args.tenant, client.id);
  const postLogout = useSectionSave({
    ...shared,
    section: 'postLogout',
    label: SECTIONS_LOGOUT.postLogout,
    fields: {
      post_logout_redirect_uris: {
        value: client.post_logout_redirect_uris,
        label: LOGOUT_FIELD.postLogout,
        kind: 'plain',
      },
    },
    save: saves.postLogout,
  });
  const confirmation = useSectionSave({
    ...shared,
    section: 'confirmation',
    label: SECTIONS_LOGOUT.confirmation,
    fields: {
      skip_logout_confirmation: {
        value: client.skip_logout_confirmation,
        label: SKIP_LOGOUT_LABEL,
        kind: 'plain',
      },
    },
    save: saves.confirmation,
  });
  const backchannel = useSectionSave({
    ...shared,
    section: 'backchannel',
    label: SECTIONS_LOGOUT.backchannel,
    fields: {
      backchannel_logout_uri: {
        value: orBlank(client.backchannel_logout_uri),
        label: LOGOUT_FIELD.backchannel,
        kind: 'plain',
      },
      backchannel_logout_session_required: {
        value: client.backchannel_logout_session_required,
        label: BACKCHANNEL_SESSION_LABEL,
        kind: 'plain',
      },
    },
    save: saves.backchannel,
  });
  const frontchannel = useSectionSave({
    ...shared,
    section: 'frontchannel',
    label: SECTIONS_LOGOUT.frontchannel,
    fields: {
      frontchannel_logout_uri: {
        value: orBlank(client.frontchannel_logout_uri),
        label: LOGOUT_FIELD.frontchannel,
        kind: 'plain',
      },
      frontchannel_logout_session_required: {
        value: client.frontchannel_logout_session_required,
        label: FRONTCHANNEL_SESSION_LABEL,
        kind: 'plain',
      },
    },
    save: saves.frontchannel,
  });
  return {
    sections: SECTIONS_LOGOUT,
    postLogout,
    postLogoutDescription: spaced(
      POST_LOGOUT_RULE,
      listCount(postLogout.values.post_logout_redirect_uris, CLIENT_LIST_LIMIT, POST_LOGOUT_NOUN),
    ),
    skipLogoutLabel: SKIP_LOGOUT_LABEL,
    skipLogoutWarningId: SKIP_LOGOUT_WARNING_ID,
    skipLogoutWarning: SKIP_LOGOUT_WARNING,
    backchannelRule: BACKCHANNEL_RULE,
    backchannelSessionLabel: BACKCHANNEL_SESSION_LABEL,
    backchannelSessionRule: BACKCHANNEL_SESSION_RULE,
    frontchannelRule: FRONTCHANNEL_RULE,
    frontchannelSessionLabel: FRONTCHANNEL_SESSION_LABEL,
    frontchannelSessionRule: FRONTCHANNEL_SESSION_RULE,
    confirmation,
    confirmationFixed: skipLogoutFixed(client),
    confirmationHint: skipLogoutHint(
      skipLogoutFixed(client),
      confirmation.values.skip_logout_confirmation,
    ),
    backchannel,
    frontchannel,
  };
}
