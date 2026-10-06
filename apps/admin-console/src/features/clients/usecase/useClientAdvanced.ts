import type { Client } from '@odudu/contracts/admin';
import {
  useClientConfigSaves,
  type AudienceValues,
  type AuthValues,
  type ExchangeValues,
  type KeyValues,
  type UserinfoValues,
} from '#/features/clients/repository/useClientConfigSaves.ts';
import {
  authOptions,
  choiceOf,
  CLIENT_LIST_LIMIT,
  EXCHANGE_LABEL,
  jwksText,
  keysProblem,
  keySourceOf,
  listCount,
  namesText,
  needsSubjectDn,
  SECTIONS_ADVANCED,
  userinfoContentOptions,
  userinfoEncryptionOptions,
  userinfoSigningOptions,
  encryptsUserinfo,
  type KeysProblem,
} from '#/features/clients/service';
import { useClientSection } from '#/features/clients/usecase/useClientSection.ts';
import { useSectionSave, type SectionSave } from '#/shared/repository/useSectionSave.ts';
import { flagText } from '#/shared/service/format.ts';
import type { SelectOption } from '#/shared/view/Field';

export interface ClientAdvanced {
  auth: SectionSave<AuthValues>;
  authMethods: SelectOption[];
  // Whether the method chosen reads a certificate subject.
  asksSubject: boolean;
  keys: SectionSave<KeyValues>;
  // What the chosen source lacks, held against the field it belongs to.
  keysProblem: KeysProblem | undefined;
  userinfo: SectionSave<UserinfoValues>;
  signingOptions: SelectOption[];
  encryptionOptions: SelectOption[];
  contentOptions: SelectOption[];
  // Whether an encryption algorithm is chosen, which the content encryption goes with.
  encrypted: boolean;
  audiences: SectionSave<AudienceValues>;
  audienceCount: string;
  exchange: SectionSave<ExchangeValues>;
}

export function useClientAdvanced(args: {
  tenant: string;
  client: Client;
  etag: string;
  gone: boolean;
}): ClientAdvanced {
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
        value: client.tls_client_auth_subject_dn ?? '',
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
      jwks_uri: { value: client.jwks_uri ?? '', label: 'JWKS URI', kind: 'plain' },
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
        describe: namesText,
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
        describe: (value) => flagText(value, 'on', 'off'),
      },
    },
    save: saves.exchange,
  });
  return {
    auth,
    authMethods: authOptions(client),
    asksSubject: needsSubjectDn(auth.values.token_endpoint_auth_method),
    keys,
    keysProblem: keysProblem(keys.values, keys.dirty),
    userinfo,
    signingOptions: userinfoSigningOptions(),
    encryptionOptions: userinfoEncryptionOptions(),
    contentOptions: userinfoContentOptions(),
    encrypted: encryptsUserinfo(userinfo.values.userinfo_encrypted_response_alg),
    audiences,
    audienceCount: listCount(audiences.values.audiences, CLIENT_LIST_LIMIT, 'audiences'),
    exchange,
  };
}
