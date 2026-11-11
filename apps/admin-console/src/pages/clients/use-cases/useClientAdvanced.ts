import {
  useClientConfigSaves,
  type ActionValues,
  type AudienceValues,
  type AuthValues,
  type ExchangeValues,
  type KeyValues,
  type UserinfoValues,
} from '#/pages/clients/repository/useClientConfigSaves';
import {
  authNote,
  authOptions,
  needsSubjectDn,
  PUBLIC_AUTH_FIXED,
  SUBJECT_DN_RULE,
} from '#/pages/clients/services/clientAuthentication';
import {
  AUDIENCES_RULE,
  EXCHANGE_ACTOR_LABEL,
  EXCHANGE_ACTOR_RULE,
  EXCHANGE_LABEL,
  EXCHANGE_PUBLIC_LABEL,
  EXCHANGE_PUBLIC_RULE,
  EXCHANGE_RULE,
  FIXED_BY_DESIGN,
} from '#/pages/clients/services/tokenExchange';
import {
  JWKS_URI_RULE,
  jwksText,
  keysBlockedBy,
  KEYS_RULE,
  KEY_SOURCES,
  keysProblem,
  keySourceOf,
  type KeysProblem,
} from '#/pages/clients/services/clientKeys';
import {
  ACTIONS_LABEL,
  ACTIONS_RULE,
  actionOptions,
  actionsBlock,
  type ActionOption,
} from '#/pages/clients/services/applicationActions';
import { SECTIONS_ADVANCED } from '#/pages/clients/services/sectionTitles';
import {
  USERINFO_RULE,
  userinfoContentOptions,
  userinfoEncryptionOptions,
  userinfoSigningOptions,
  encryptsUserinfo,
} from '#/pages/clients/services/userinfoResponse';
import { choiceOf } from '#/pages/clients/services/choices';
import { CLIENT_LIST_LIMIT, listCount } from '#/pages/clients/services/listEntries';
import {
  useClientSection,
  type ClientRecordRead,
} from '#/pages/clients/use-cases/useClientSection';
import { describeActions } from '#/entities/subject';
import { useSectionSave, type SectionSave } from '#/shared/lib/repository/useSectionSave';
import type { Choice } from '#/shared/lib/services/choice';
import { namesOrNone, orBlank, spaced } from '#/shared/lib/services/format';

export interface ClientAdvanced {
  sections: typeof SECTIONS_ADVANCED;
  // Why a public client's authentication cannot be chosen.
  publicAuthFixed: string;
  // What the chosen authentication method means.
  authNote: string | undefined;
  subjectDnRule: string;
  keySources: readonly Choice[];
  keysRule: string;
  // Why Save is held while the key source lacks something.
  keysBlocked: string | undefined;
  jwksUriRule: string;
  userinfoRule: string;
  audiencesDescription: string;
  exchangeLabel: string;
  exchangeRule: string;
  exchangePublicLabel: string;
  exchangePublicRule: string;
  exchangeActorLabel: string;
  exchangeActorRule: string;
  // What cannot be changed, each with its value and why.
  fixedByDesign: typeof FIXED_BY_DESIGN;
  auth: SectionSave<AuthValues>;
  authMethods: Choice[];
  // Whether the method chosen reads a certificate subject.
  asksSubject: boolean;
  keys: SectionSave<KeyValues>;
  // What the chosen source lacks, held against the field it belongs to.
  keysProblem: KeysProblem | undefined;
  userinfo: SectionSave<UserinfoValues>;
  signingOptions: Choice[];
  encryptionOptions: Choice[];
  contentOptions: Choice[];
  // Whether an encryption algorithm is chosen, which the content encryption goes with.
  encrypted: boolean;
  audiences: SectionSave<AudienceValues>;
  exchange: SectionSave<ExchangeValues>;
  actions: SectionSave<ActionValues>;
  actionsLabel: string;
  actionsRule: string;
  actionOptions: ActionOption[];
  // Why Save is held while an action is chosen and the client lacks me:read.
  actionsBlocked: string | undefined;
}

export function useClientAdvanced(args: ClientRecordRead): ClientAdvanced {
  const { client } = args;
  const shared = useClientSection(args);
  const saves = useClientConfigSaves(args.tenant, client.id);
  const auth = useSectionSave({
    ...shared,
    section: 'auth',
    label: SECTIONS_ADVANCED.auth,
    fields: {
      token_endpoint_auth_method: {
        value: client.token_endpoint_auth_method,
        label: 'Authentication method',
        kind: 'plain',
      },
      tls_client_auth_subject_dn: {
        value: orBlank(client.tls_client_auth_subject_dn),
        label: 'Certificate subject',
        kind: 'plain',
      },
    },
    save: saves.auth,
  });
  const keys = useSectionSave({
    ...shared,
    section: 'keys',
    label: SECTIONS_ADVANCED.keys,
    fields: {
      key_source: { value: keySourceOf(client), label: 'Key source', kind: 'plain' },
      jwks_uri: { value: orBlank(client.jwks_uri), label: 'JWKS URI', kind: 'plain' },
      jwks: { value: jwksText(client.jwks), label: 'Key set', kind: 'plain' },
    },
    save: saves.keys,
  });
  const userinfo = useSectionSave({
    ...shared,
    section: 'userinfo',
    label: SECTIONS_ADVANCED.userinfo,
    fields: {
      userinfo_signed_response_alg: {
        value: choiceOf(client.userinfo_signed_response_alg),
        label: 'Signing algorithm',
        kind: 'plain',
      },
      userinfo_encrypted_response_alg: {
        value: choiceOf(client.userinfo_encrypted_response_alg),
        label: 'Encryption algorithm',
        kind: 'plain',
      },
      userinfo_encrypted_response_enc: {
        value: choiceOf(client.userinfo_encrypted_response_enc),
        label: 'Content encryption',
        kind: 'plain',
      },
    },
    save: saves.userinfo,
  });
  const audiences = useSectionSave({
    ...shared,
    section: 'audiences',
    label: SECTIONS_ADVANCED.audiences,
    fields: {
      audiences: {
        value: client.audiences,
        label: 'Audiences',
        kind: 'plain',
        describe: namesOrNone,
      },
    },
    save: saves.audiences,
  });
  const exchange = useSectionSave({
    ...shared,
    section: 'exchange',
    label: SECTIONS_ADVANCED.exchange,
    fields: {
      token_exchange_impersonation_allowed: {
        value: client.token_exchange_impersonation_allowed,
        label: EXCHANGE_LABEL,
        kind: 'plain',
      },
      token_exchange_allowed_for_public: {
        value: client.token_exchange_allowed_for_public,
        label: EXCHANGE_PUBLIC_LABEL,
        kind: 'plain',
      },
      token_exchange_actor_from_other_client: {
        value: client.token_exchange_actor_from_other_client,
        label: EXCHANGE_ACTOR_LABEL,
        kind: 'plain',
      },
    },
    save: saves.exchange,
  });
  const actions = useSectionSave({
    ...shared,
    section: 'actions',
    label: SECTIONS_ADVANCED.actions,
    fields: {
      allowed_actions: {
        value: client.allowed_actions,
        label: ACTIONS_LABEL,
        kind: 'plain',
        describe: describeActions,
      },
    },
    save: saves.actions,
  });
  const problem = keysProblem(keys.values, keys.dirty);
  return {
    sections: SECTIONS_ADVANCED,
    publicAuthFixed: PUBLIC_AUTH_FIXED,
    authNote: authNote(auth.values.token_endpoint_auth_method),
    subjectDnRule: SUBJECT_DN_RULE,
    keySources: KEY_SOURCES,
    keysRule: KEYS_RULE,
    keysBlocked: keysBlockedBy(problem),
    jwksUriRule: JWKS_URI_RULE,
    userinfoRule: USERINFO_RULE,
    audiencesDescription: spaced(
      AUDIENCES_RULE,
      listCount(audiences.values.audiences, CLIENT_LIST_LIMIT, 'audiences'),
    ),
    exchangeLabel: EXCHANGE_LABEL,
    exchangeRule: EXCHANGE_RULE,
    exchangePublicLabel: EXCHANGE_PUBLIC_LABEL,
    exchangePublicRule: EXCHANGE_PUBLIC_RULE,
    exchangeActorLabel: EXCHANGE_ACTOR_LABEL,
    exchangeActorRule: EXCHANGE_ACTOR_RULE,
    fixedByDesign: FIXED_BY_DESIGN,
    auth,
    authMethods: authOptions(client),
    asksSubject: needsSubjectDn(auth.values.token_endpoint_auth_method),
    keys,
    keysProblem: problem,
    userinfo,
    signingOptions: userinfoSigningOptions(),
    encryptionOptions: userinfoEncryptionOptions(),
    contentOptions: userinfoContentOptions(),
    encrypted: encryptsUserinfo(userinfo.values.userinfo_encrypted_response_alg),
    audiences,
    exchange,
    actions,
    actionsLabel: ACTIONS_LABEL,
    actionsRule: ACTIONS_RULE,
    actionOptions: actionOptions(),
    actionsBlocked: actionsBlock(actions.values.allowed_actions, client.scopes),
  };
}
