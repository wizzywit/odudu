import type { Client } from '@odudu/contracts/admin';
import {
  useClientConfigSaves,
  type BackchannelValues,
  type FrontchannelValues,
  type PostLogoutValues,
} from '#/features/clients/repository/useClientConfigSaves.ts';
import {
  BACKCHANNEL_SESSION_LABEL,
  CLIENT_LIST_LIMIT,
  FRONTCHANNEL_SESSION_LABEL,
  LOGOUT_FIELD,
  listCount,
  POST_LOGOUT_NOUN,
  SECTIONS_LOGOUT,
} from '#/features/clients/service';
import { useClientSection } from '#/features/clients/usecase/useClientSection.ts';
import { useSectionSave, type SectionSave } from '#/shared/repository/useSectionSave.ts';
import { flagText } from '#/shared/service/format.ts';

export interface ClientLogout {
  postLogout: SectionSave<PostLogoutValues>;
  postLogoutCount: string;
  backchannel: SectionSave<BackchannelValues>;
  frontchannel: SectionSave<FrontchannelValues>;
}

export function useClientLogout(args: {
  tenant: string;
  client: Client;
  etag: string;
  gone: boolean;
}): ClientLogout {
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
  const backchannel = useSectionSave({
    ...shared,
    section: 'backchannel',
    label: SECTIONS_LOGOUT.backchannel,
    fields: {
      backchannel_logout_uri: {
        value: client.backchannel_logout_uri ?? '',
        label: LOGOUT_FIELD.backchannel,
        kind: 'plain',
      },
      backchannel_logout_session_required: {
        value: client.backchannel_logout_session_required,
        label: BACKCHANNEL_SESSION_LABEL,
        kind: 'plain',
        describe: (value) => flagText(value, 'on', 'off'),
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
        value: client.frontchannel_logout_uri ?? '',
        label: LOGOUT_FIELD.frontchannel,
        kind: 'plain',
      },
      frontchannel_logout_session_required: {
        value: client.frontchannel_logout_session_required,
        label: FRONTCHANNEL_SESSION_LABEL,
        kind: 'plain',
        describe: (value) => flagText(value, 'on', 'off'),
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
    backchannel,
    frontchannel,
  };
}
