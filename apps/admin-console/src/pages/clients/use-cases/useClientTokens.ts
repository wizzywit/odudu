import type { ClientTokenTtlField } from '#/pages/clients/types/tokenTtl';
import {
  useClientConfigSaves,
  type CredentialValues,
  type FullScopeValues,
  type GrantValues,
  type IdTokenValues,
  type LifetimeValues,
} from '#/pages/clients/repository/useClientConfigSaves';
import { choiceOf } from '#/pages/clients/services/choices';
import { CLIENT_LIST_LIMIT, listCount } from '#/pages/clients/services/listEntries';
import {
  AUTH_TIME_LABEL,
  AUTH_TIME_RULE,
  FULL_SCOPE_LABEL,
  FULL_SCOPE_RULE,
  ID_TOKEN_ALG_LABEL,
  ID_TOKEN_ALG_RULE,
  idTokenAlgOptions,
  MAX_AGE_LABEL,
  MAX_AGE_MAX,
  MAX_AGE_OFF,
  MAX_AGE_RULE,
  MAX_AGE_START,
  maxAgeText,
  REQUIRE_AUTH_TIME_NOTE,
} from '#/pages/clients/services/idTokenPolicy';
import {
  CREDENTIALS_NOUN,
  CREDENTIALS_RULE,
  GRANTS_RULE,
  grantOptions,
  grantsBlock,
  GRANT_LABELS,
} from '#/pages/clients/services/grantTypes';
import {
  lifetimeBounds,
  keptSeconds,
  lifetimeRule,
  LIFETIMES,
  lifetimeText,
  LIFETIME_LABELS,
  secondsReading,
  tenantLifetimeLabel,
} from '#/pages/clients/services/tokenLifetimes';
import { SECTIONS_TOKENS, TOKEN_FIELD } from '#/pages/clients/services/sectionTitles';
import {
  useClientSection,
  type ClientRecordRead,
} from '#/pages/clients/use-cases/useClientSection';
import { useSectionSave, type SectionSave } from '#/shared/lib/repository/useSectionSave';
import { describeIds, namesOrNone, spaced } from '#/shared/lib/services/format';
import type { ChecklistOption } from '#/shared/ui/ChecklistField';
import type { Choice } from '#/shared/lib/services/choice';

// A duration the client may leave to a default, as the tab shows it.
export interface SecondsFieldView {
  label: string;
  offLabel: string;
  // What the default is, said while the duration is left to it.
  offText: string;
  rule: string;
  start: number;
  min: number;
  max: number | undefined;
  // The value as a read-only page says it.
  readText: string;
}

export interface LifetimeFieldView extends SecondsFieldView {
  field: ClientTokenTtlField;
}

export interface ClientTokens {
  // Sets a lifetime to a number entered, or leaves it as it was when cleared.
  setLifetime: (field: ClientTokenTtlField, value: number | null) => void;
  setMaxAge: (value: number | null) => void;
  sections: typeof SECTIONS_TOKENS;
  lifetimeFields: readonly LifetimeFieldView[];
  grantsRule: string;
  credentialsDescription: string;
  fullScope: SectionSave<FullScopeValues>;
  fullScopeLabel: string;
  fullScopeRule: string;
  idTokenAlgLabel: string;
  idTokenAlgRule: string;
  maxAge: SecondsFieldView;
  authTimeLabel: string;
  authTimeDescription: string;
  lifetimes: SectionSave<LifetimeValues>;
  grants: SectionSave<GrantValues>;
  grantOptions: ChecklistOption[];
  // Why the grants cannot be saved as chosen, or undefined.
  grantsBlocked: string | undefined;
  credentials: SectionSave<CredentialValues>;
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
        describe: namesOrNone,
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

  const credentialCount = listCount(
    credentials.values.client_credentials_scopes,
    CLIENT_LIST_LIMIT,
    CREDENTIALS_NOUN,
  );
  return {
    setLifetime: (field, value) => {
      lifetimes.edit(field, keptSeconds(value, lifetimes.values[field]));
    },
    setMaxAge: (value) => {
      idToken.edit('default_max_age', keptSeconds(value, idToken.values.default_max_age));
    },
    sections: SECTIONS_TOKENS,
    lifetimeFields: LIFETIMES.map((each) => ({
      field: each.field,
      label: each.label,
      offLabel: tenantLifetimeLabel(each.label),
      offText: each.inherits,
      rule: lifetimeRule(each.field),
      start: each.start,
      ...lifetimeBounds(each.field),
      readText: secondsReading(lifetimes.values[each.field], each.inherits),
    })),
    grantsRule: GRANTS_RULE,
    credentialsDescription: spaced(CREDENTIALS_RULE, credentialCount),
    fullScopeLabel: FULL_SCOPE_LABEL,
    fullScopeRule: FULL_SCOPE_RULE,
    idTokenAlgLabel: ID_TOKEN_ALG_LABEL,
    idTokenAlgRule: ID_TOKEN_ALG_RULE,
    maxAge: {
      label: MAX_AGE_LABEL,
      offLabel: 'No default',
      offText: MAX_AGE_OFF,
      rule: MAX_AGE_RULE,
      start: MAX_AGE_START,
      min: 0,
      max: MAX_AGE_MAX,
      readText: secondsReading(idToken.values.default_max_age, MAX_AGE_OFF),
    },
    authTimeLabel: AUTH_TIME_LABEL,
    authTimeDescription: spaced(AUTH_TIME_RULE, REQUIRE_AUTH_TIME_NOTE),
    lifetimes,
    grants,
    grantOptions: grantOptions(client),
    grantsBlocked:
      grantsBlock(grants.values.grant_types, client.redirect_uris.length) ?? grants.blocked,
    credentials,
    fullScope,
    idToken,
    idTokenAlgs: idTokenAlgOptions(),
  };
}
