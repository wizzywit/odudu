import {
  useClientConfigSaves,
  type CredentialValues,
  type FullScopeValues,
  type GrantValues,
  type IdTokenValues,
  type LifetimeValues,
} from '#/features/clients/repository/useClientConfigSaves';
import { choiceOf } from '#/features/clients/services/choices';
import { CLIENT_LIST_LIMIT, listCount, namesText } from '#/features/clients/services/lists';
import {
  AUTH_TIME_LABEL,
  CREDENTIALS_NOUN,
  grantOptions,
  grantsBlock,
  GRANT_LABELS,
  ID_TOKEN_ALG_LABEL,
  idTokenAlgOptions,
  lifetimeText,
  LIFETIME_LABELS,
  MAX_AGE_LABEL,
  maxAgeText,
  SECTIONS_TOKENS,
  TOKEN_FIELD,
} from '#/features/clients/services/tokens';
import {
  useClientSection,
  type ClientRecordRead,
} from '#/features/clients/use-cases/useClientSection';
import { useSectionSave, type SectionSave } from '#/shared/repository/useSectionSave';
import { describeIds } from '#/shared/services/format';
import type { ChecklistOption } from '#/shared/ui/ChecklistField';
import type { Choice } from '#/shared/services/choice';

export interface ClientTokens {
  lifetimes: SectionSave<LifetimeValues>;
  grants: SectionSave<GrantValues>;
  grantOptions: ChecklistOption[];
  // Why the grants cannot be saved as chosen, or undefined.
  grantsBlocked: string | undefined;
  credentials: SectionSave<CredentialValues>;
  credentialCount: string;
  fullScope: SectionSave<FullScopeValues>;
  idToken: SectionSave<IdTokenValues>;
  idTokenAlgs: Choice[];
}

export function useClientTokens(args: ClientRecordRead): ClientTokens {
  const { client } = args;
  const shared = useClientSection(args);
  const saves = useClientConfigSaves(args.tenant, client.id);

  const lifetimes = useSectionSave({
    ...shared,
    section: 'lifetimes',
    label: SECTIONS_TOKENS.lifetimes,
    fields: {
      access_token_ttl_seconds: {
        value: client.access_token_ttl_seconds,
        label: LIFETIME_LABELS.access_token_ttl_seconds,
        kind: 'plain',
        describe: lifetimeText,
      },
      id_token_ttl_seconds: {
        value: client.id_token_ttl_seconds,
        label: LIFETIME_LABELS.id_token_ttl_seconds,
        kind: 'plain',
        describe: lifetimeText,
      },
      refresh_token_ttl_seconds: {
        value: client.refresh_token_ttl_seconds,
        label: LIFETIME_LABELS.refresh_token_ttl_seconds,
        kind: 'plain',
        describe: lifetimeText,
      },
    },
    save: saves.lifetimes,
  });
  const grants = useSectionSave({
    ...shared,
    section: 'grants',
    label: SECTIONS_TOKENS.grants,
    fields: {
      grant_types: {
        value: client.grant_types,
        label: TOKEN_FIELD.grants,
        kind: 'plain',
        describe: (value) => describeIds(value, (id) => GRANT_LABELS[id] ?? id),
      },
    },
    save: saves.grants,
  });
  const credentials = useSectionSave({
    ...shared,
    section: 'credentials',
    label: SECTIONS_TOKENS.credentials,
    fields: {
      client_credentials_scopes: {
        value: client.client_credentials_scopes,
        label: TOKEN_FIELD.credentials,
        kind: 'plain',
        describe: namesText,
      },
    },
    save: saves.credentials,
  });
  const fullScope = useSectionSave({
    ...shared,
    section: 'fullScope',
    label: SECTIONS_TOKENS.fullScope,
    fields: {
      full_scope_allowed: {
        value: client.full_scope_allowed,
        label: TOKEN_FIELD.fullScope,
        kind: 'plain',
      },
    },
    save: saves.fullScope,
  });
  const idToken = useSectionSave({
    ...shared,
    section: 'idToken',
    label: SECTIONS_TOKENS.idToken,
    fields: {
      id_token_signed_response_alg: {
        value: choiceOf(client.id_token_signed_response_alg),
        label: ID_TOKEN_ALG_LABEL,
        kind: 'plain',
      },
      default_max_age: {
        value: client.default_max_age,
        label: MAX_AGE_LABEL,
        kind: 'plain',
        describe: maxAgeText,
      },
      require_auth_time: {
        value: client.require_auth_time,
        label: AUTH_TIME_LABEL,
        kind: 'plain',
      },
    },
    save: saves.idToken,
  });

  return {
    lifetimes,
    grants,
    grantOptions: grantOptions(client),
    grantsBlocked:
      grantsBlock(grants.values.grant_types, client.redirect_uris.length) ?? grants.blocked,
    credentials,
    credentialCount: listCount(
      credentials.values.client_credentials_scopes,
      CLIENT_LIST_LIMIT,
      CREDENTIALS_NOUN,
    ),
    fullScope,
    idToken,
    idTokenAlgs: idTokenAlgOptions(),
  };
}
