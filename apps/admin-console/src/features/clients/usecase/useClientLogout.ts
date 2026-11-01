import {
  useClientConfigSaves,
  type BackchannelValues,
  type ConfirmationValues,
  type FrontchannelValues,
  type PostLogoutValues,
} from '#/features/clients/repository/useClientConfigSaves';
import {
  BACKCHANNEL_SESSION_LABEL,
  CLIENT_LIST_LIMIT,
  FRONTCHANNEL_SESSION_LABEL,
  LOGOUT_FIELD,
  listCount,
  POST_LOGOUT_NOUN,
  SECTIONS_LOGOUT,
  skipLogoutFixed,
  skipLogoutHint,
  SKIP_LOGOUT_LABEL,
} from '#/features/clients/service';
import {
  useClientSection,
  type ClientRecordRead,
} from '#/features/clients/usecase/useClientSection';
import { useSectionSave, type SectionSave } from '#/shared/repository/useSectionSave';
import { orBlank } from '#/shared/service/format';

export interface ClientLogout {
  postLogout: SectionSave<PostLogoutValues>;
  postLogoutCount: string;
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
    postLogout,
    postLogoutCount: listCount(
      postLogout.values.post_logout_redirect_uris,
      CLIENT_LIST_LIMIT,
      POST_LOGOUT_NOUN,
    ),
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
