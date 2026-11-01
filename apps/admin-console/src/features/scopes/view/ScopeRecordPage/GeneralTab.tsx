import type { ClientScope } from '@odudu/contracts/admin';
import {
  ACCESS_TOKEN_LABEL,
  CONSENT_LANGUAGES_LABEL,
  CONSENT_LANGUAGES_NOTE,
  CONSENT_LIMIT,
  DESCRIPTION_LANGUAGES_LABEL,
  DESCRIPTION_LANGUAGES_NOTE,
  ID_TOKEN_LABEL,
  NAME_FIXED,
  NEW_CLIENT_LABEL,
} from '#/features/scopes/service';
import {
  useScopeGeneral,
  type Deletion,
  type ScopeGeneral,
} from '#/features/scopes/usecase/useScopeGeneral';
import { DESCRIPTION_MAX } from '#/shared/service/labels';
import { DeleteZone } from '#/shared/view/DeleteZone';
import { DescriptionField } from '#/shared/view/DescriptionField';
import { SelectField, TextAreaField, TextField, ToggleField } from '#/shared/view/Field';
import { LocalisedTextField } from '#/shared/view/LocalisedTextField';
import { Panel } from '#/shared/view/Panel';
import { SaveSection } from '#/shared/view/SaveSection';
import { Timestamp } from '#/shared/view/Timestamp';
import { recordTab } from '#/shared/view/RecordTab';

function Fixed({ scope }: { scope: ClientScope }) {
  return (
    <Panel title="Name">
      <dl className={recordTab.fixed}>
        <div>
          <dt>Name</dt>
          <dd>
            <code>{scope.name}</code>
          </dd>
        </div>
        <div>
          <dt>Created</dt>
          <dd>
            <Timestamp value={scope.created_at} />
          </dd>
        </div>
      </dl>
      <p className={recordTab.rule}>{NAME_FIXED}</p>
    </Panel>
  );
}

function Description({ general }: { general: ScopeGeneral }) {
  const s = general.description;
  return (
    <SaveSection
      title="Description"
      description="What the scope is for, shown wherever it is chosen."
      save={s}
    >
      <DescriptionField save={s} rule={general.descriptionRule} />
      <LocalisedTextField
        label={DESCRIPTION_LANGUAGES_LABEL}
        description={DESCRIPTION_LANGUAGES_NOTE}
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

function Tokens({ general }: { general: ScopeGeneral }) {
  const s = general.tokens;
  return (
    <SaveSection
      title="Tokens"
      description="Where the scope's claims are carried once it is granted."
      save={s}
    >
      <ToggleField
        label={ID_TOKEN_LABEL}
        value={s.values.include_in_id_token}
        error={s.fieldErrors.include_in_id_token}
        changed={s.changed.includes('include_in_id_token')}
        onChange={(value) => {
          s.edit('include_in_id_token', value);
        }}
      />
      <ToggleField
        label={ACCESS_TOKEN_LABEL}
        value={s.values.include_in_access_token}
        error={s.fieldErrors.include_in_access_token}
        changed={s.changed.includes('include_in_access_token')}
        onChange={(value) => {
          s.edit('include_in_access_token', value);
        }}
      />
    </SaveSection>
  );
}

function NewClients({ general }: { general: ScopeGeneral }) {
  const s = general.assignment;
  return (
    <SaveSection
      title="New clients"
      description="Whether a client made from now on is given this scope. Clients that already exist are not changed."
      save={s}
    >
      <SelectField
        label={NEW_CLIENT_LABEL}
        options={general.assignmentChoices}
        value={s.values.default_client_assignment}
        error={s.fieldErrors.default_client_assignment}
        changed={s.changed.includes('default_client_assignment')}
        onChange={(value) => {
          s.edit('default_client_assignment', value);
        }}
      />
    </SaveSection>
  );
}

function Consent({ general }: { general: ScopeGeneral }) {
  const s = general.consent;
  return (
    <SaveSection
      title="Consent"
      description="How the consent screen lists the scope: its text, and its place among the others, lowest first."
      save={s}
    >
      <TextAreaField
        label="Consent text"
        description={general.consentRule}
        value={s.values.consent_text}
        error={s.fieldErrors.consent_text}
        changed={s.changed.includes('consent_text')}
        onChange={(value) => {
          s.edit('consent_text', value);
        }}
      />
      <LocalisedTextField
        label={CONSENT_LANGUAGES_LABEL}
        description={CONSENT_LANGUAGES_NOTE}
        languages={general.languages}
        value={s.values.consent_text_i18n}
        limit={CONSENT_LIMIT}
        multiline
        error={s.fieldErrors.consent_text_i18n}
        changed={s.changed.includes('consent_text_i18n')}
        onChange={(next) => {
          s.edit('consent_text_i18n', next);
        }}
      />
      <TextField
        label="Display order"
        value={s.values.display_order}
        error={s.fieldErrors.display_order}
        changed={s.changed.includes('display_order')}
        onChange={(value) => {
          s.edit('display_order', value);
        }}
      />
    </SaveSection>
  );
}

function Danger({ name, deletion }: { name: string; deletion: Deletion }) {
  return (
    <DeleteZone
      name={name}
      deletion={deletion}
      consequence={deletion.warning}
      typed={name}
      held={deletion.held}
      retry={deletion.retry}
      lead={
        deletion.fixed === null ? (
          <p className={recordTab.text}>{deletion.consequence}</p>
        ) : undefined
      }
      note={
        deletion.fixed === null ? undefined : <p className={recordTab.text}>{deletion.fixed}</p>
      }
    />
  );
}

export function GeneralTab({
  tenant,
  scope,
  etag,
  gone,
}: {
  tenant: string;
  scope: ClientScope;
  etag: string;
  gone: boolean;
}) {
  const general = useScopeGeneral({ tenant, scope, etag, gone });
  return (
    <div className={recordTab.tab}>
      <Fixed scope={scope} />
      <Description general={general} />
      <Tokens general={general} />
      <NewClients general={general} />
      <Consent general={general} />
      <Danger name={scope.name} deletion={general.deletion} />
    </div>
  );
}
