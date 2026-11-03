import {
  useClientSection,
  type ClientRecordRead,
} from '#/features/clients/use-cases/useClientSection';
import { useGo } from '#/shared/repository/useGo';
import {
  useClientDeletion,
  useClientSaves,
  type ConsentValues,
  type DetailValues,
  type EnabledValues,
  type PageValues,
  type TranslationSectionValues,
} from '#/features/clients/repository/useClientRecord';
import { clientsHref } from '#/features/clients/services/address';
import { deleteFixed, enabledFixed } from '#/features/clients/services/blocks';
import { deleteConsequence } from '#/features/clients/services/confirm';
import { FIELD, SECTION } from '#/features/clients/services/clientDetails';
import { clientRefusal } from '#/features/clients/services/refusal';
import {
  DESCRIPTION_TRANSLATIONS_FIELD,
  NAME_TRANSLATIONS_FIELD,
  offeredBy,
} from '#/features/clients/services/translations';
import { useSectionSave, type SectionSave } from '#/shared/repository/useSectionSave';
import { useToast } from '#/shared/repository/useToasts';
import { useConfirmedRemoval, type Removal } from '#/shared/use-cases/useConfirmedChange';
import { deletedText, writeFailureText } from '#/shared/services/failure';
import { DESCRIPTION_MAX, DESCRIPTION_RULE } from '#/shared/services/labels';
import { orBlank } from '#/shared/services/format';
import { describeTranslations } from '#/shared/services/localised';
import type { Read } from '#/shared/services/read';

export type { SectionSave };

export interface Deletion extends Removal {
  consequence: string;
}

export interface ClientGeneral {
  details: SectionSave<DetailValues>;
  translations: SectionSave<TranslationSectionValues>;
  // The languages the tenant offers, which the translations are written in.
  languages: Read<string[]>;
  descriptionRule: string;
  descriptionLimit: number;
  pages: SectionSave<PageValues>;
  availability: SectionSave<EnabledValues>;
  // Why it cannot be disabled, said in place of the toggle.
  enabledFixed: string | null;
  consent: SectionSave<ConsentValues>;
  // Why it cannot be deleted, said in place of the button.
  deleteFixed: string | null;
  deletion: Deletion;
}

export function useClientGeneral({ tenant, client, etag, gone }: ClientRecordRead): ClientGeneral {
  const saves = useClientSaves(tenant, client.id);
  const toast = useToast();
  const go = useGo();
  const shared = useClientSection({ tenant, client, etag, gone });
  const copy = {
    name: client.name,
    verb: 'deleted',
    lookAt: 'the clients',
    refused: clientRefusal,
  };
  const deletion = useClientDeletion(tenant, client.id);
  const removal = useConfirmedRemoval({
    refusal: shared.refusal,
    capability: shared.capability,
    change: deletion,
    failureText: (failure) => writeFailureText(failure, copy),
    onRefused: shared.onRefused,
    done: () => {
      toast.succeeded(deletedText(client.name));
      go(clientsHref(tenant), { replace: true });
    },
  });

  const details = useSectionSave({
    ...shared,
    section: 'details',
    label: SECTION.details,
    fields: {
      name: { value: client.name, label: FIELD.name, kind: 'plain' },
      description: { value: orBlank(client.description), label: FIELD.description, kind: 'plain' },
    },
    save: saves.details,
  });
  const translations = useSectionSave({
    ...shared,
    section: 'translations',
    label: SECTION.translations,
    fields: {
      name_i18n: {
        value: client.name_i18n,
        label: NAME_TRANSLATIONS_FIELD,
        kind: 'plain',
        describe: describeTranslations,
      },
      description_i18n: {
        value: client.description_i18n,
        label: DESCRIPTION_TRANSLATIONS_FIELD,
        kind: 'plain',
        describe: describeTranslations,
      },
    },
    save: saves.translations,
  });
  const pages = useSectionSave({
    ...shared,
    section: 'pages',
    label: SECTION.pages,
    fields: {
      client_uri: { value: orBlank(client.client_uri), label: FIELD.homePage, kind: 'plain' },
      policy_uri: { value: orBlank(client.policy_uri), label: FIELD.privacyPolicy, kind: 'plain' },
      tos_uri: { value: orBlank(client.tos_uri), label: FIELD.termsOfService, kind: 'plain' },
    },
    save: saves.pages,
  });
  const availability = useSectionSave({
    ...shared,
    section: 'availability',
    label: SECTION.availability,
    fields: {
      enabled: {
        value: client.enabled,
        label: FIELD.enabled,
        kind: 'plain',
      },
    },
    save: saves.availability,
  });
  const consent = useSectionSave({
    ...shared,
    section: 'consent',
    label: SECTION.consent,
    fields: {
      consent_required: {
        value: client.consent_required,
        label: FIELD.consentRequired,
        kind: 'plain',
      },
    },
    save: saves.consent,
  });

  return {
    details,
    translations,
    languages: offeredBy(client),
    descriptionRule: DESCRIPTION_RULE,
    descriptionLimit: DESCRIPTION_MAX,
    pages,
    availability,
    enabledFixed: enabledFixed(client),
    consent,
    deleteFixed: deleteFixed(client),
    deletion: { ...removal, consequence: deleteConsequence(client.name) },
  };
}
