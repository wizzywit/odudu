import type { Client } from '@odudu/contracts/admin';
import {
  CLIENT_ID_FIXED,
  DESCRIPTION_TRANSLATIONS_LABEL,
  DESCRIPTION_TRANSLATIONS_NOTE,
  NAME_TRANSLATIONS_LABEL,
  NAME_TRANSLATIONS_NOTE,
  PAGES_RULE,
  SECTION,
  TRANSLATIONS_LEAD,
  registeredText,
  TYPE_FIXED,
  TYPE_TEXT,
} from '#/features/clients/service';
import {
  useClientGeneral,
  type ClientGeneral,
  type Deletion,
} from '#/features/clients/usecase/useClientGeneral';
import type { ClientTabProps } from '#/features/clients/view/ClientTabProps';
import { DESCRIPTION_MAX } from '#/shared/service/labels';
import { DeleteZone } from '#/shared/view/DeleteZone';
import { DescriptionField } from '#/shared/view/DescriptionField';
import { LocalisedTextField } from '#/shared/view/LocalisedTextField';
import { Panel } from '#/shared/view/Panel';
import { CopyValue } from '#/shared/view/CopyValue';
import { TextField, ToggleField, UrlField } from '#/shared/view/Field';
import { FieldGrid, GridCell } from '#/shared/view/FieldGrid';
import { SaveSection } from '#/shared/view/SaveSection';
import { Timestamp } from '#/shared/view/Timestamp';
import { recordTab } from '#/shared/view/RecordTab';

function Fixed({ client }: { client: Client }) {
  return (
    <Panel title="Identity">
      <dl className={recordTab.fixed}>
        <div>
          <dt>Client ID</dt>
          <dd>
            <CopyValue label="client ID" value={client.client_id} />
          </dd>
        </div>
        <div>
          <dt>Type</dt>
          <dd>{TYPE_TEXT[client.type] ?? client.type}</dd>
        </div>
        <div>
          <dt>Registered</dt>
          <dd>{registeredText(client.registration_origin)}</dd>
        </div>
        <div>
          <dt>Created</dt>
          <dd>
            <Timestamp value={client.created_at} />
          </dd>
        </div>
      </dl>
      <p className={recordTab.rule}>{`${CLIENT_ID_FIXED} ${TYPE_FIXED}`}</p>
    </Panel>
  );
}

function Details({ general }: { general: ClientGeneral }) {
  const s = general.details;
  return (
    <SaveSection
      title="Details"
      description="How the client is named wherever a person meets it."
      save={s}
    >
      <TextField
        label="Name"
        description="Shown on the consent screen."
        value={s.values.name}
        error={s.fieldErrors.name}
        changed={s.changed.includes('name')}
        onChange={(value) => {
          s.edit('name', value);
        }}
      />
      <DescriptionField save={s} rule={general.descriptionRule} limit={general.descriptionLimit} />
    </SaveSection>
  );
}

function Translations({ general }: { general: ClientGeneral }) {
  const s = general.translations;
  return (
    <SaveSection title={SECTION.translations} description={TRANSLATIONS_LEAD} save={s}>
      <LocalisedTextField
        label={NAME_TRANSLATIONS_LABEL}
        description={NAME_TRANSLATIONS_NOTE}
        languages={general.languages}
        value={s.values.name_i18n}
        error={s.fieldErrors.name_i18n}
        changed={s.changed.includes('name_i18n')}
        onChange={(next) => {
          s.edit('name_i18n', next);
        }}
      />
      <LocalisedTextField
        label={DESCRIPTION_TRANSLATIONS_LABEL}
        description={DESCRIPTION_TRANSLATIONS_NOTE}
        languages={general.languages}
        value={s.values.description_i18n}
        limit={DESCRIPTION_MAX}
        multiline
        error={s.fieldErrors.description_i18n}
        changed={s.changed.includes('description_i18n')}
        onChange={(next) => {
          s.edit('description_i18n', next);
        }}
      />
    </SaveSection>
  );
}

function Pages({ general }: { general: ClientGeneral }) {
  const s = general.pages;
  return (
    <SaveSection title="Consent screen links" description={PAGES_RULE} save={s}>
      <FieldGrid>
        <GridCell span="full">
          <UrlField
            label="Home page"
            autoComplete="off"
            value={s.values.client_uri}
            error={s.fieldErrors.client_uri}
            changed={s.changed.includes('client_uri')}
            onChange={(value) => {
              s.edit('client_uri', value);
            }}
          />
        </GridCell>
        <GridCell span="full">
          <UrlField
            label="Privacy policy"
            autoComplete="off"
            value={s.values.policy_uri}
            error={s.fieldErrors.policy_uri}
            changed={s.changed.includes('policy_uri')}
            onChange={(value) => {
              s.edit('policy_uri', value);
            }}
          />
        </GridCell>
        <GridCell span="full">
          <UrlField
            label="Terms of service"
            autoComplete="off"
            value={s.values.tos_uri}
            error={s.fieldErrors.tos_uri}
            changed={s.changed.includes('tos_uri')}
            onChange={(value) => {
              s.edit('tos_uri', value);
            }}
          />
        </GridCell>
      </FieldGrid>
    </SaveSection>
  );
}

function Availability({ general }: { general: ClientGeneral }) {
  const s = general.availability;
  return (
    <SaveSection title="Availability" save={s}>
      {general.enabledFixed === null ? (
        <ToggleField
          label="Enabled"
          description="A disabled client signs nobody in and issues no token; its configuration is kept."
          value={s.values.enabled}
          changed={s.changed.includes('enabled')}
          onChange={(value) => {
            s.edit('enabled', value);
          }}
        />
      ) : (
        <p className={recordTab.rule}>{general.enabledFixed}</p>
      )}
    </SaveSection>
  );
}

function Consent({ general }: { general: ClientGeneral }) {
  const s = general.consent;
  return (
    <SaveSection title="Consent" save={s}>
      <ToggleField
        label="Consent required"
        description="Each person is asked to approve what the client receives before it is given, once, and the approval is kept."
        value={s.values.consent_required}
        changed={s.changed.includes('consent_required')}
        onChange={(value) => {
          s.edit('consent_required', value);
        }}
      />
    </SaveSection>
  );
}

function Danger({
  name,
  clientId,
  fixed,
  deletion,
}: {
  name: string;
  clientId: string;
  fixed: string | null;
  deletion: Deletion;
}) {
  return (
    <DeleteZone
      name={name}
      deletion={deletion}
      consequence={deletion.consequence}
      typed={clientId}
      lead={
        fixed === null ? (
          <p className={recordTab.text}>
            A deleted client is gone with the roles scoped to it, and no application can sign in
            through it again. Its ID is typed to confirm, since two clients may share a name.
          </p>
        ) : undefined
      }
      note={fixed === null ? undefined : <p className={recordTab.rule}>{fixed}</p>}
    />
  );
}

// `writable` is whether the page offers any change: left out where it does
// not, since the page's one line says why.
export function GeneralTab({ tenant, client, etag, gone, writable }: ClientTabProps) {
  const general = useClientGeneral({ tenant, client, etag, gone });
  return (
    <div className={recordTab.tab}>
      <Fixed client={client} />
      <Details general={general} />
      <Translations general={general} />
      <Pages general={general} />
      <Availability general={general} />
      <Consent general={general} />
      {writable ? (
        <Danger
          name={client.name}
          clientId={client.client_id}
          fixed={general.deleteFixed}
          deletion={general.deletion}
        />
      ) : null}
    </div>
  );
}
