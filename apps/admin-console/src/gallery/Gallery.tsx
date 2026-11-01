import { useState, type ReactNode } from 'react';
import { advance, type CursorTrail } from '#/shared/service/cursorTrail';
import type { Read } from '#/shared/service/read';
import type { Translations } from '#/shared/service/localised';
import type { PickerState } from '#/shared/service/picker';
import type { ListSearch, ResourceListState } from '#/shared/service/resourceList';
import { current, dirtyFields, discard, edit, startDraft } from '#/shared/service/dirty';
import type { Toast } from '#/shared/service/toast';
import { AccessGate } from '#/shared/view/AccessGate';
import { ActivityTab } from '#/shared/view/ActivityTab';
import { ChecklistField } from '#/shared/view/ChecklistField';
import { CodeField } from '#/shared/view/CodeField';
import { LocalisedTextField } from '#/shared/view/LocalisedTextField';
import { AuditActor } from '#/shared/view/AuditActor';
import { ActionMenu } from '#/shared/view/ActionMenu';
import { AuditDetail } from '#/shared/view/AuditDetail';
import { AuditTable } from '#/shared/view/AuditTable';
import { AppShell } from '#/shared/view/AppShell';
import { Breadcrumb } from '#/shared/view/Breadcrumb';
import { BrandLine } from '#/shared/view/BrandLine';
import { Button } from '#/shared/view/Button';
import { CreationActions, CreationForm } from '#/shared/view/CreationForm';
import { DeleteZone } from '#/shared/view/DeleteZone';
import { DescriptionField } from '#/shared/view/DescriptionField';
import { KeyHint, PlatformContext } from '#/shared/view/KeyHint';
import { ButtonLink } from '#/shared/view/ButtonLink';
import { CapabilityNote } from '#/shared/view/CapabilityNote';
import { InlineFailed } from '#/shared/view/InlineFailed';
import { LastAction } from '#/shared/view/LastAction';
import { ListGate } from '#/shared/view/ListGate';
import { AssignedList, AssignedRow, AssignPanel } from '#/shared/view/AssignmentControls';
import { LoadFailed } from '#/shared/view/LoadFailed';
import { LoadMore, LoadMoreFailed } from '#/shared/view/LoadMore';
import { LiveMessage, Problem } from '#/shared/view/Message';
import { MappedRoles } from '#/shared/view/MappedRoles';
import { NarrowedNote } from '#/shared/view/NarrowedNote';
import { Note, NoteCode } from '#/shared/view/Note';
import { ChunkFailed } from '#/shared/view/ChunkBoundary';
import { ConfirmDialog } from '#/shared/view/ConfirmDialog';
import { ConflictPanel } from '#/shared/view/ConflictPanel';
import { ContextBar } from '#/shared/view/ContextBar';
import { CopyValue } from '#/shared/view/CopyValue';
import { Count } from '#/shared/view/Count';
import { DataTable, type Column } from '#/shared/view/DataTable';
import { Duration } from '#/shared/view/Duration';
import { EmptyState } from '#/shared/view/EmptyState';
import {
  BirthdateField,
  ComboBoxField,
  CountryField,
  DateTimeField,
  GenderField,
  KeyValueField,
  LocaleField,
  NumberWithUnitField,
  PhoneField,
  PictureField,
  ReadOnlyFields,
  SelectField,
  TextField,
  TimeZoneField,
  ToggleField,
  UrlField,
  UrlListField,
} from '#/shared/view/Field';
import { FieldGrid, GridCell } from '#/shared/view/FieldGrid';
import { FilterBar } from '#/shared/view/FilterBar';
import { GroupPicker } from '#/shared/view/GroupPicker';
import { PageHeader } from '#/shared/view/PageHeader';
import { FailurePanel } from '#/shared/view/FailurePanel';
import { PageNotFound } from '#/shared/view/PageNotFound';
import { Pager } from '#/shared/view/Pager';
import { Panel } from '#/shared/view/Panel';
import { Rail } from '#/shared/view/Rail';
import { ReadGate } from '#/shared/view/ReadGate';
import { RecordActivity } from '#/shared/view/RecordActivity';
import { RecordPage } from '#/shared/view/RecordPage';
import { recordTab } from '#/shared/view/RecordTab';
import { ResourceListPage } from '#/shared/view/ResourceListPage';
import { RoleOwner } from '#/shared/view/RoleOwner';
import { ClientPicker } from '#/shared/view/ClientPicker';
import { RolePicker } from '#/shared/view/RolePicker';
import { SaveBar } from '#/shared/view/SaveBar';
import { SaveSection } from '#/shared/view/SaveSection';
import { SecretDialog } from '#/shared/view/SecretDialog';
import { Section } from '#/shared/view/Section';
import { SectionNotice } from '#/shared/view/SectionNotice';
import {
  FormSkeleton,
  ListSkeleton,
  RecordSkeleton,
  Skeleton,
  TableSkeleton,
  TermsSkeleton,
} from '#/shared/view/Skeleton';
import { StatusTag } from '#/shared/view/StatusTag';
import { Tabs } from '#/shared/view/Tabs';
import { TouchTargets } from '#/shared/view/TouchTargets';
import { Timestamp } from '#/shared/view/Timestamp';
import { Toasts } from '#/shared/view/Toasts';
import { UnsavedChangesDialog } from '#/shared/view/UnsavedChangesDialog';
import { ViewOnlyNote } from '#/shared/view/ViewOnlyNote';
import styles from '#/gallery/Gallery.module.css';
import {
  CLAIM_VALUES,
  CLIENT_SECRET,
  CLIENT_FIELDS,
  CLIENTS,
  CONFLICTS,
  DETAILED_EVENT,
  EVENTS,
  GROUPS,
  JWKS_SAMPLE,
  NOW,
  RAIL_GROUPS,
  REDIRECT_URIS,
  ROLES,
  STEP_REQUIREMENTS,
  SUBJECT_FIELDS,
  TENANT,
  type ClientRow,
} from '#/gallery/samples';

export type GalleryDialog = 'plain' | 'typed' | 'secret' | 'unsaved';
export type GalleryTheme = 'light' | 'dark';

const COLUMNS: readonly Column<ClientRow>[] = [
  { id: 'name', header: 'Name', cell: (c) => c.name, isRowHeader: true },
  { id: 'client_id', header: 'Client id', cell: (c) => <code>{c.clientId}</code> },
  { id: 'type', header: 'Type', cell: (c) => c.type },
  {
    id: 'status',
    header: 'Status',
    cell: (c) =>
      c.enabled ? <StatusTag tone="active">enabled</StatusTag> : <StatusTag>disabled</StatusTag>,
  },
  {
    id: 'id',
    header: 'Id',
    cell: (c) => <CopyValue label={`id of ${c.name}`} value={c.id} short />,
    secondary: true,
  },
  {
    id: 'created',
    header: 'Created',
    cell: (c) => <Timestamp value={c.created} now={NOW} />,
    secondary: true,
  },
];

const TOASTS: readonly Toast[] = [
  { id: 'saved', tone: 'success', message: 'Billing portal saved' },
  { id: 'failed', tone: 'error', message: 'The gateway could not be reached. Nothing was saved.' },
];

function Group({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={styles.group}>
      <h2 id={`${id}-title`} className={styles.groupTitle}>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Specimen({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.specimen}>
      <p className={styles.specimenLabel}>{label}</p>
      <div className={styles.specimenBody}>{children}</div>
    </div>
  );
}

function General() {
  const [draft, setDraft] = useState(() =>
    edit(
      startDraft({
        name: 'Billing portal',
        accessTokenTtl: 300,
        consent: 'required',
        pkce: true,
      }),
      'name',
      'Billing portal (EU)',
    ),
  );
  const values = current(draft);
  const changed = new Set<string>(dirtyFields(draft));
  return (
    <Section
      title="General"
      description="How the client is named, and how long what it is issued lasts."
      dirty={changed.size > 0}
      saving={false}
      restored={changed.size > 0}
      onSave={() => {
        setDraft(startDraft(values));
      }}
      onDiscard={() => {
        setDraft(discard(draft));
      }}
    >
      <TextField
        label="Name"
        description="Shown to people on the consent page."
        value={values.name}
        changed={changed.has('name')}
        onChange={(name) => {
          setDraft(edit(draft, 'name', name));
        }}
      />
      <NumberWithUnitField
        label="Access token lifetime"
        unit="seconds"
        value={values.accessTokenTtl}
        changed={changed.has('accessTokenTtl')}
        onChange={(ttl) => {
          setDraft(edit(draft, 'accessTokenTtl', ttl));
        }}
      />
      <SelectField
        label="Consent"
        options={[
          { id: 'required', label: 'Ask every time' },
          { id: 'remembered', label: 'Ask once, then remember' },
          { id: 'skipped', label: 'Never ask (first-party)' },
        ]}
        value={values.consent}
        changed={changed.has('consent')}
        onChange={(consent) => {
          setDraft(edit(draft, 'consent', consent));
        }}
      />
      <ToggleField
        label="Require PKCE"
        description="Refuses an authorization code redeemed without its verifier."
        value={values.pkce}
        changed={changed.has('pkce')}
        onChange={(pkce) => {
          setDraft(edit(draft, 'pkce', pkce));
        }}
      />
    </Section>
  );
}

function Redirects() {
  const [uris, setUris] = useState(REDIRECT_URIS);
  const [claims, setClaims] = useState(CLAIM_VALUES);
  return (
    <Section
      title="Redirects & origins"
      dirty
      saving
      onSave={() => undefined}
      onDiscard={() => undefined}
    >
      <UrlListField
        label="Redirect URIs"
        itemLabel="Redirect URI"
        description="Matched exactly, including the path and any query."
        value={uris}
        onChange={setUris}
        itemErrors={[undefined, 'A redirect URI must use https outside localhost.']}
        changed
      />
      <KeyValueField
        label="Hard-coded claims"
        keyLabel="Claim"
        valueLabel="Value"
        value={claims}
        onChange={setClaims}
        error="Claim names must be unique."
      />
    </Section>
  );
}

function Lists() {
  const [trail, setTrail] = useState<CursorTrail>(() => advance([], 'c2'));
  const [search, setSearch] = useState({ field: 'username', query: 'ad' });
  return (
    <>
      <FilterBar
        label="Filter subjects"
        fields={SUBJECT_FIELDS}
        field={search.field}
        query={search.query}
        onSearch={setSearch}
        onClear={() => {
          setSearch({ field: 'username', query: '' });
        }}
        active={search.query !== ''}
      >
        <Count count={10000} capped noun={{ one: 'subject', other: 'subjects' }} />
      </FilterBar>
      <DataTable
        label="All clients"
        columns={COLUMNS}
        rows={CLIENTS}
        rowKey={(c) => c.id}
        onRowAction={() => undefined}
      />
      <Pager
        label="All clients"
        list={{ trail, next: 'c4', setTrail, loadMore: () => undefined }}
      />
      <div className={styles.counts}>
        <Count count={1204} capped={false} noun={{ one: 'client', other: 'clients' }} />
        <Count count={1} capped={false} noun={{ one: 'group', other: 'groups' }} />
        <Count count={1000} capped noun={{ one: 'role', other: 'roles' }} />
      </div>
    </>
  );
}

const FAILURE_DETAILS =
  'Error ID: 7K3QX9MD\nPage: /$tenant/clients/$id\nTime: 2026-10-22T09:30:15.123Z';

const NOTHING = (): void => undefined;

function ClientList() {
  const [trail, setTrail] = useState<CursorTrail>([]);
  const [search, setSearch] = useState<ListSearch | null>(null);
  const rows = search === null ? CLIENTS : CLIENTS.filter((c) => c.name.startsWith(search.query));
  const list: ResourceListState<ClientRow> = {
    status: 'ready',
    rows,
    count: { count: rows.length, capped: false },
    search,
    filters: {},
    narrowed: search !== null,
    trail,
    next: search === null ? 'c4' : null,
    loadingMore: false,
    loadLimited: false,
    loadMoreFailed: false,
    setSearch: (next) => {
      setSearch(next.query === '' ? null : next);
    },
    setFilter: NOTHING,
    clear: () => {
      setSearch(null);
    },
    setTrail,
    loadMore: NOTHING,
    retry: NOTHING,
  };
  return (
    <ResourceListPage
      list={list}
      kicker={TENANT}
      title="Clients"
      description="Applications that sign people in through this tenant."
      noun={{ one: 'client', other: 'clients' }}
      searchFields={CLIENT_FIELDS}
      columns={COLUMNS}
      rowKey={(c) => c.id}
      onRowAction={NOTHING}
      capability="manage-clients"
      actions={<Button variant="primary">Create client</Button>}
    />
  );
}

function SubjectRecord() {
  const [tab, setTab] = useState('profile');
  const [updated, setUpdated] = useState(true);
  return (
    <RecordPage
      record={{
        status: 'ready',
        updated,
        refreshFailed: false,
        gone: false,
        acknowledge: () => {
          setUpdated(false);
        },
        retry: NOTHING,
      }}
      breadcrumb={[
        { label: 'Identity' },
        { label: 'Subjects', href: '#editing' },
        { label: 'ada' },
      ]}
      title="ada"
      status={<StatusTag tone="active">enabled</StatusTag>}
      noun="subject"
      label="Subject sections"
      tab={tab}
      onTabChange={setTab}
      actions={<Button>Open the audit trail</Button>}
      tabs={[
        {
          id: 'profile',
          label: 'Profile',
          panel: (
            <div className={styles.stack}>
              <p>Claims and verification</p>
              <section aria-labelledby="gallery-danger" className={styles.danger}>
                <h2 id="gallery-danger">Danger zone</h2>
                <p>Deleting ada ends every session and cannot be undone.</p>
                <div>
                  <Button variant="danger">Delete ada</Button>
                </div>
              </section>
            </div>
          ),
        },
        { id: 'roles', label: 'Roles', panel: <p>Roles held directly</p> },
        {
          id: 'activity',
          label: 'Activity',
          panel: <ActivityTab list={listOf(EVENTS, 'c2')} noun="subject" now={NOW} />,
        },
      ]}
    />
  );
}

function listOf<T>(rows: readonly T[], next: string | null): ResourceListState<T> {
  return {
    status: 'ready',
    rows,
    count: null,
    search: null,
    filters: {},
    narrowed: false,
    trail: [],
    next,
    loadingMore: false,
    loadLimited: false,
    loadMoreFailed: false,
    setSearch: NOTHING,
    setFilter: NOTHING,
    clear: NOTHING,
    setTrail: NOTHING,
    loadMore: NOTHING,
    retry: NOTHING,
  };
}

function pickerOf<T>(options: readonly T[], more: boolean): PickerState<T> {
  return {
    status: 'ready',
    options,
    query: '',
    search: NOTHING,
    more,
    loadingMore: false,
    loadLimited: false,
    loadMore: NOTHING,
    retry: NOTHING,
  };
}

const CLIENT_OPTIONS = [
  { id: 'c1', name: 'Billing', client_id: 'billing', type: 'confidential' as const },
  { id: 'c2', name: 'Portal', client_id: 'portal', type: 'public' as const },
];

function Pickers() {
  const [roles, setRoles] = useState<readonly string[]>(['r2']);
  const [clients, setClients] = useState<readonly string[]>([]);
  const [groups, setGroups] = useState<readonly string[]>([]);
  return (
    <div className={styles.grid}>
      <RolePicker
        label="Roles"
        picker={pickerOf(ROLES, true)}
        selected={roles}
        onChange={setRoles}
      />
      <GroupPicker
        label="Groups"
        picker={pickerOf(GROUPS, false)}
        selected={groups}
        onChange={setGroups}
      />
      <ClientPicker
        label="Clients"
        picker={pickerOf(CLIENT_OPTIONS, false)}
        selected={clients}
        onChange={setClients}
        selectionMode="single"
      />
    </div>
  );
}

const GRANT_TYPES = [
  { id: 'authorization_code', label: 'authorization_code' },
  { id: 'client_credentials', label: 'client_credentials' },
  { id: 'refresh_token', label: 'refresh_token' },
  { id: 'urn:ietf:params:oauth:grant-type:device_code', label: 'device_code' },
];

const CLAIMS = {
  phone: '+2348031234567',
  birthdate: '1815-12-10',
  gender: 'non-binary',
  country: 'Nigeria',
  zone: 'Africa/Lagos',
  locale: 'en-NG',
  website: 'https://ada.example',
  picture: 'https://cdn.example/ada.png',
};

type ClaimName = keyof typeof CLAIMS;

function TypedFields() {
  const [claims, setClaims] = useState(CLAIMS);
  const [grant, setGrant] = useState('authorization_code');
  const [birthYear, setBirthYear] = useState('1815');
  const [withheld, setWithheld] = useState('0000-12-10');
  const set = (name: ClaimName) => (value: string) => {
    setClaims((was) => ({ ...was, [name]: value }));
  };
  return (
    <div className={styles.typed}>
      <PhoneField label="Phone number" value={claims.phone} onChange={set('phone')} />
      <BirthdateField label="Birthdate" value={claims.birthdate} onChange={set('birthdate')} />
      <BirthdateField label="Birthdate, year only" value={birthYear} onChange={setBirthYear} />
      <BirthdateField label="Birthdate, year withheld" value={withheld} onChange={setWithheld} />
      <CountryField label="Country" value={claims.country} onChange={set('country')} changed />
      <TimeZoneField label="Time zone" value={claims.zone} onChange={set('zone')} />
      <LocaleField label="Locale" value={claims.locale} onChange={set('locale')} />
      <GenderField label="Gender" value={claims.gender} onChange={set('gender')} />
      <UrlField label="Website" value={claims.website} onChange={set('website')} />
      <PictureField label="Picture" value={claims.picture} onChange={set('picture')} />
      <UrlField label="Profile page, mistyped" value="ada.example" onChange={NOTHING} />
      <ComboBoxField
        label="Grant type"
        description="Type to narrow the list."
        options={GRANT_TYPES}
        value={grant}
        onChange={setGrant}
      />
    </div>
  );
}

const STYLESHEET = `/* The sign-in page's accent */
:root {
  --accent: #0a7c55;
  --radius: 4px;
}
.button { color: var(--accent); }
`;

const TRANSLATED: Translations = { fr: 'Bienvenue' };

function CodeAndTranslations() {
  const [css, setCss] = useState(STYLESHEET);
  const [name, setName] = useState(TRANSLATED);
  const languages: Read<string[]> = { status: 'ready', data: ['en', 'fr', 'de'] };
  return (
    <div className={styles.typed}>
      <CodeField
        label="Stylesheet"
        description="Applied to the sign-in pages."
        language="css"
        value={css}
        onChange={setCss}
        size={{ text: '84 of 16,384 bytes used.', over: false }}
      />
      <CodeField
        label="Stylesheet, a line refused"
        language="css"
        value={STYLESHEET}
        onChange={NOTHING}
        issues={[{ line: 3, text: 'a colour must be a hex value' }]}
        error="The stylesheet was refused."
        changed
      />
      <CodeField
        label="Stylesheet, read only"
        language="css"
        value="a { }"
        isDisabled
        onChange={NOTHING}
      />
      <LocalisedTextField
        label="Welcome heading"
        description="Shown above the sign-in form."
        languages={languages}
        value={name}
        onChange={setName}
      />
      <LocalisedTextField
        label="Welcome text"
        languages={languages}
        value={{}}
        onChange={NOTHING}
        multiline
        limit={200}
      />
    </div>
  );
}

const PROFILE = {
  name: 'Ada Lovelace',
  given: 'Ada',
  family: 'Lovelace',
  middle: '',
  nickname: 'Ada',
  preferred: 'ada',
  phone: '+447700900123;ext=12',
  profile: 'https://ada.example/about',
  picture: 'https://cdn.example/ada.png',
  website: 'https://ada.example',
  gender: 'female',
  birthdate: '1815-12-10',
  zone: 'Europe/London',
  locale: 'en-GB',
  formatted: '12 St James’s Square, London SW1Y 4JH',
  street: '12 St James’s Square',
  locality: 'London',
  region: '',
  postal: 'SW1Y 4JH',
  country: 'United Kingdom',
};

type ProfileName = keyof typeof PROFILE;

// The record's Profile tab as it lays its claims out: one control height,
// three columns, the phone and the street wider than one.
function ProfileCloseUp() {
  const [p, setProfile] = useState(PROFILE);
  const set = (name: ProfileName) => (value: string) => {
    setProfile((was) => ({ ...was, [name]: value }));
  };
  const text = (name: ProfileName, label: string) => (
    <GridCell>
      <TextField label={label} value={p[name]} onChange={set(name)} />
    </GridCell>
  );
  return (
    <div className={styles.sections}>
      <Section title="Name" dirty={false} saving={false} onSave={NOTHING} onDiscard={NOTHING}>
        <FieldGrid>
          {text('name', 'Full name')}
          {text('given', 'Given name')}
          {text('family', 'Family name')}
          {text('middle', 'Middle name')}
          {text('nickname', 'Nickname')}
          {text('preferred', 'Preferred username')}
        </FieldGrid>
      </Section>
      <Section title="Details" dirty={false} saving={false} onSave={NOTHING} onDiscard={NOTHING}>
        <FieldGrid>
          <GridCell span="wide">
            <PhoneField label="Phone number" value={p.phone} onChange={set('phone')} />
          </GridCell>
          <GridCell>
            <GenderField label="Gender" value={p.gender} onChange={set('gender')} />
          </GridCell>
          <GridCell>
            <UrlField label="Profile page" value={p.profile} onChange={set('profile')} />
          </GridCell>
          <GridCell>
            <UrlField label="Website" value={p.website} onChange={set('website')} />
          </GridCell>
          <GridCell>
            <PictureField label="Picture" value={p.picture} onChange={set('picture')} />
          </GridCell>
          <GridCell>
            <BirthdateField label="Birthdate" value={p.birthdate} onChange={set('birthdate')} />
          </GridCell>
          <GridCell>
            <TimeZoneField label="Time zone" value={p.zone} onChange={set('zone')} />
          </GridCell>
          <GridCell>
            <LocaleField label="Locale" value={p.locale} onChange={set('locale')} />
          </GridCell>
        </FieldGrid>
      </Section>
      <Section title="Address" dirty={false} saving={false} onSave={NOTHING} onDiscard={NOTHING}>
        <FieldGrid>
          <GridCell span="full">
            <TextField label="Formatted address" value={p.formatted} onChange={set('formatted')} />
          </GridCell>
          <GridCell span="wide">
            <TextField label="Street" value={p.street} onChange={set('street')} />
          </GridCell>
          {text('locality', 'Locality')}
          {text('region', 'Region')}
          {text('postal', 'Postal code')}
          <GridCell>
            <CountryField label="Country" value={p.country} onChange={set('country')} />
          </GridCell>
        </FieldGrid>
      </Section>
    </div>
  );
}

function ViewOnly() {
  return (
    <div className={styles.typed}>
      <div className={styles.span}>
        <ViewOnlyNote noun="subjects" needs={['manage-users']} />
      </div>
      <ReadOnlyFields when>
        <TextField label="Full name" value="Ada Lovelace" onChange={NOTHING} />
        <TextField label="Nickname" value="" onChange={NOTHING} />
        <TextField
          label="Middle name, an edit refused"
          value="Augusta"
          changed
          onChange={NOTHING}
        />
        <PhoneField label="Phone number" value={CLAIMS.phone} onChange={NOTHING} />
        <BirthdateField label="Birthdate" value={CLAIMS.birthdate} onChange={NOTHING} />
        <LocaleField label="Locale" value={CLAIMS.locale} onChange={NOTHING} />
        <ToggleField label="Email verified" value onChange={NOTHING} />
      </ReadOnlyFields>
    </div>
  );
}

function Dialogs({ initial }: { initial: GalleryDialog | null }) {
  const [open, setOpen] = useState<GalleryDialog | null>(initial);
  const close = (): void => {
    setOpen(null);
  };
  return (
    <div className={styles.row}>
      <Button
        variant="danger"
        onPress={() => {
          setOpen('plain');
        }}
      >
        End session
      </Button>
      <Button
        variant="danger"
        onPress={() => {
          setOpen('typed');
        }}
      >
        Disable tenant
      </Button>
      <Button
        onPress={() => {
          setOpen('secret');
        }}
      >
        Generate a new secret
      </Button>
      <Button
        onPress={() => {
          setOpen('unsaved');
        }}
      >
        Leave this page
      </Button>
      <ConfirmDialog
        isOpen={open === 'plain'}
        title="End this session?"
        consequence="ada@acme.example is signed out of every client on this session's next request."
        confirmLabel="End session"
        tone="danger"
        onConfirm={close}
        onCancel={close}
      />
      <ConfirmDialog
        isOpen={open === 'typed'}
        title={`Disable ${TENANT}?`}
        consequence={`Nobody in ${TENANT} can sign in, and every token it issued stops being refreshed, until it is enabled again.`}
        confirmLabel={`Disable ${TENANT}`}
        tone="danger"
        typed={TENANT}
        onConfirm={close}
        onCancel={close}
      />
      <SecretDialog
        secret={open === 'secret' ? CLIENT_SECRET : null}
        title="New secret for Billing portal"
        label="client secret"
        onClose={close}
      >
        The previous secret stopped working when this one was generated.
      </SecretDialog>
      <UnsavedChangesDialog
        isOpen={open === 'unsaved'}
        sections={['General', 'Redirects & origins']}
        onStay={close}
        onLeave={close}
      />
    </div>
  );
}

const NO_SAVE = {
  status: 'idle' as const,
  conflicts: [],
  conflictSource: 'changed' as const,
  message: null,
  saving: false,
  keepMine: NOTHING,
  takeTheirs: NOTHING,
  reread: NOTHING,
  dirty: true,
  restored: false,
  blocked: undefined,
  discard: NOTHING,
  submit: () => true,
};

const NO_DELETION = {
  confirming: false,
  busy: false,
  problem: null,
  ask: NOTHING,
  cancel: NOTHING,
  confirm: NOTHING,
};

function readOf(status: string, data: string | undefined) {
  return { status, data, etag: data === undefined ? null : '"e1"', gone: false, retry: NOTHING };
}

function RecordPieces() {
  return (
    <div className={styles.stack}>
      <Specimen label="Panel, with the record tab's text, rule and actions">
        <div className={recordTab.tab}>
          <Panel title="Identifier">
            <p className={recordTab.text}>billing-portal</p>
            <p className={recordTab.rule}>Fixed once the client is made.</p>
            <div className={recordTab.actions}>
              <Button>Copy</Button>
            </div>
          </Panel>
        </div>
      </Specimen>
      <Specimen label="DescriptionField: a record's description, one section's field">
        <DescriptionField
          rule="Leave it empty for none."
          limit={200}
          save={{
            values: { description: 'Keeps the books' },
            fieldErrors: {},
            changed: [],
            edit: NOTHING,
          }}
        />
      </Specimen>
      <Specimen label="SaveSection: a section wired to one save">
        <SaveSection title="Description" description="What the client is for." save={NO_SAVE}>
          <p>Its fields</p>
        </SaveSection>
      </Specimen>
      <Specimen label="DeleteZone: what a delete takes, the danger button and its confirmation">
        <DeleteZone
          name="billing-portal"
          deletion={NO_DELETION}
          consequence="Its roles go with it."
          typed="billing-portal"
          lead={
            <p className={recordTab.text}>A deleted client is gone with the roles scoped to it.</p>
          }
        />
      </Specimen>
      <Specimen label="ActionMenu: what a narrow bar folds under one button">
        <ActionMenu
          label="More actions"
          trigger="More"
          actions={[
            { id: 'revert', label: 'Revert this tab', onAction: NOTHING },
            { id: 'discard', label: 'Discard draft…', tone: 'danger', onAction: NOTHING },
          ]}
        />
      </Specimen>
      <Specimen label="TouchTargets: controls at 44px on a touch or narrow screen">
        <TouchTargets>
          <Button>A control that grows</Button>
        </TouchTargets>
      </Specimen>
      <Specimen label="MappedRoles: what a group or a scope hands on">
        <MappedRoles name="billing" mapped={ROLES} />
      </Specimen>
      <Specimen label="NarrowedNote: a list narrowed to one record">
        <NarrowedNote all="Show every role" onClear={NOTHING}>
          Only the roles of client <code>billing-portal</code>.
        </NarrowedNote>
      </Specimen>
      <div className={styles.grid}>
        <Specimen label="LoadFailed">
          <LoadFailed title="The groups could not be loaded" retry={NOTHING} />
        </Specimen>
        <Specimen label="Problem, and a live message that has something to say">
          <div className={styles.stack}>
            <Problem>The secret could not be rotated.</Problem>
            <LiveMessage label="Last mint">Minted a token that can be used 3 times.</LiveMessage>
          </div>
        </Specimen>
        <Specimen label="InlineFailed">
          <InlineFailed message="The groups under /eng could not be loaded." retry={NOTHING} />
        </Specimen>
        <Specimen label="LoadMore: regular, compact and busy, and its failure">
          <div className={styles.stack}>
            <LoadMore noun="deliveries" loading={false} limited={false} onPress={NOTHING} />
            <LoadMore compact noun="groups under /eng" loading limited={false} onPress={NOTHING} />
            <LoadMoreFailed noun="deliveries" />
          </div>
        </Specimen>
        <Specimen label="ListGate: loading, refused, failed, and the rows">
          <div className={styles.stack}>
            {(['loading', 'refused', 'failed', 'ready'] as const).map((status) => (
              <ListGate
                key={status}
                list={{ status, retry: NOTHING }}
                loading={<ListSkeleton label="Loading the sessions" items={1} />}
                refused={{ capability: 'view-sessions', noun: 'Sessions' }}
                failed="The sessions could not be loaded"
              >
                {() => <p>The rows</p>}
              </ListGate>
            ))}
          </div>
        </Specimen>
        <Specimen label="LastAction: what the last action did, once there was one">
          <LastAction label="Last revoke" count={0}>
            Revoked the token created Oct 12.
          </LastAction>
        </Specimen>
        <Specimen label="AssignPanel, and an assignment that can be changed, one that cannot">
          <div className={styles.stack}>
            <AssignPanel
              title="Assign to a client"
              assignment="default"
              onAssignment={NOTHING}
              label="Assign to Billing"
              disabled={false}
              onAssign={() => Promise.resolve(true)}
            >
              <p>The picker goes here.</p>
            </AssignPanel>
            <AssignedList label="Scopes assigned to Billing">
              <AssignedRow
                name={<code>billing</code>}
                assignment={{
                  label: 'Assignment of billing',
                  value: 'optional',
                  onChange: () => Promise.resolve(true),
                }}
                working={false}
                remove={{
                  verb: 'Remove',
                  target: 'billing',
                  onRemove: () => Promise.resolve(true),
                }}
              />
              <AssignedRow
                name={<code>openid</code>}
                assignment="default"
                working={false}
                remove={null}
              />
            </AssignedList>
          </div>
        </Specimen>
        <Specimen label="ReadGate: loading, failed, and the record">
          <div className={styles.stack}>
            {(
              [
                ['loading', undefined],
                ['failed', undefined],
                ['ready', 'The record'],
              ] as const
            ).map(([status, data]) => (
              <ReadGate
                key={status}
                read={readOf(status, data)}
                label="Loading the groups"
                fields={2}
                failed="The roles could not be loaded"
              >
                {(record) => <p>{record}</p>}
              </ReadGate>
            ))}
          </div>
        </Specimen>
      </div>
      <Specimen label="RecordActivity: a tab that needs view-audit">
        <RecordActivity
          resource="client"
          tenant={TENANT}
          id="c1"
          lead="Every change made to this client, and every change refused."
          readable={false}
        />
      </Specimen>
      <Specimen label="CreationForm: the form a record is made on, and what it ends in">
        <CreationForm submit={NOTHING}>
          <TextField label="Name" value="" onChange={NOTHING} />
          <CreationActions
            noun="role"
            lookFor="billing"
            busy={false}
            unconfirmed={false}
            onCheck={NOTHING}
            listHref="#records"
            message={null}
          />
        </CreationForm>
      </Specimen>
      <Specimen label="AccessGate: a principal whoami says cannot read the area">
        <AccessGate
          access={{ kind: 'refused', capability: 'view-users' }}
          title="Subjects"
          kicker={TENANT}
          checking={null}
        >
          <p>The page</p>
        </AccessGate>
      </Specimen>
      <Specimen label="BrandLine: the staff mark beside the product name">
        <BrandLine>odudu · acme</BrandLine>
      </Specimen>
      <Specimen label="PageNotFound: an address that is no page">
        <PageNotFound />
      </Specimen>
    </div>
  );
}
function ThemeChoice({
  theme,
  onChange,
}: {
  theme: GalleryTheme;
  onChange: (theme: GalleryTheme) => void;
}) {
  return (
    <div className={styles.row} role="group" aria-label="Theme">
      {(['light', 'dark'] as const).map((choice) => (
        <Button
          key={choice}
          size="small"
          variant={choice === theme ? 'primary' : 'secondary'}
          aria-pressed={choice === theme}
          onPress={() => {
            onChange(choice);
          }}
        >
          {choice === 'light' ? 'Light' : 'Dark'}
        </Button>
      ))}
    </div>
  );
}

export function Gallery({
  initialDialog = null,
  initialCollapsed = false,
  theme = 'light',
  onThemeChange = () => undefined,
}: {
  initialDialog?: GalleryDialog | null;
  initialCollapsed?: boolean;
  theme?: GalleryTheme;
  onThemeChange?: (theme: GalleryTheme) => void;
}) {
  const [toasts, setToasts] = useState(TOASTS);
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  return (
    <AppShell
      collapsed={collapsed}
      onCollapsedChange={setCollapsed}
      rail={
        <Rail
          label="Tenant areas"
          groups={RAIL_GROUPS}
          currentHref="#editing"
          header={<strong className={styles.brand}>odudu · {TENANT}</strong>}
          footer={<span className={styles.railFooter}>ada@acme.example</span>}
        />
      }
      contextBar={<ContextBar tenant={TENANT} backHref="#basics" />}
    >
      <PageHeader
        kicker="Design system"
        title="Instrument"
        description="Every component of the admin console with sample data, in one theme at a time."
        actions={<ThemeChoice theme={theme} onChange={onThemeChange} />}
      />
      <div className={styles.page}>
        <Group id="basics" title="Actions, status and values">
          <Specimen label="Button">
            <div className={styles.row}>
              <Button variant="primary">Create client</Button>
              <Button>Export</Button>
              <Button variant="quiet">Cancel</Button>
              <Button variant="danger">Delete client</Button>
              <Button isDisabled>Saving…</Button>
              <Button size="small">Small</Button>
            </div>
          </Specimen>
          <Specimen label="KeyHint: a shortcut told, not offered, on each platform">
            <div className={styles.row}>
              <PlatformContext value="other">
                <Button variant="primary">Save</Button>
                <KeyHint lead="or press" keys={['Enter']} />
              </PlatformContext>
              <PlatformContext value="mac">
                <Button variant="primary">Save</Button>
                <KeyHint lead="or press" keys={['Enter']} />
                <KeyHint lead="Press" keys={['Mod', 'k']} />
              </PlatformContext>
            </div>
          </Specimen>
          <Specimen label="ButtonLink">
            <div className={styles.row}>
              <ButtonLink href="#basics" variant="primary">
                Create a tenant
              </ButtonLink>
              <ButtonLink href="#basics">Import a tenant</ButtonLink>
            </div>
          </Specimen>
          <Specimen label="Breadcrumb: the way up from a page below a list">
            <Breadcrumb
              label="Breadcrumb specimen"
              items={[
                { label: 'System' },
                { label: 'Tenants', href: '#basics' },
                { label: TENANT },
              ]}
            />
          </Specimen>
          <Specimen label="StatusTag">
            <div className={styles.row}>
              <StatusTag tone="active">active</StatusTag>
              <StatusTag tone="warning">rotating</StatusTag>
              <StatusTag tone="danger">locked out</StatusTag>
              <StatusTag>retired</StatusTag>
              <StatusTag tone="system-authority">system</StatusTag>
            </div>
          </Specimen>
          <Specimen label="RoleOwner">
            <div className={styles.row}>
              <RoleOwner role={{ client_id: null, client_key: null }} />
              <RoleOwner role={{ client_id: 'c-portal', client_key: 'portal' }} />
              <RoleOwner role={{ client_id: 'c-admin', client_key: 'odudu-admin' }} />
            </div>
          </Specimen>
          <Specimen label="CopyValue">
            <div className={styles.stack}>
              <CopyValue label="issuer" value="https://id.acme.example/acme" />
              <CopyValue label="client id" value={CLIENTS[0]?.id ?? ''} short />
              <CopyValue label="JWKS" value={JWKS_SAMPLE} block />
            </div>
          </Specimen>
          <Specimen label="Timestamp · Duration · Count">
            <div className={styles.stack}>
              <Timestamp value="2026-09-28T13:41:05Z" now={NOW} />
              <Duration seconds={1209600} />
              <Count count={10000} capped noun={{ one: 'subject', other: 'subjects' }} />
            </div>
          </Specimen>
          <Specimen label="Note">
            <Note>
              Nothing here can be changed until <NoteCode>manage-tenant</NoteCode> is read.
            </Note>
          </Specimen>
          <Specimen label="CapabilityNote">
            <CapabilityNote capability="manage-clients">Rotating a secret</CapabilityNote>
          </Specimen>
          <Specimen label="AuditActor: named, unnamed, and a caller from elsewhere">
            <div className={styles.stack}>
              {EVENTS.map((event) => (
                <AuditActor key={event.id} event={event} />
              ))}
            </div>
          </Specimen>
        </Group>

        <Group id="editing" title="Editing">
          <Tabs
            label="Client sections"
            tabs={[
              { id: 'general', label: 'General', dirty: true, panel: <General /> },
              { id: 'redirects', label: 'Redirects & origins', dirty: true, panel: <Redirects /> },
              { id: 'tokens', label: 'Tokens', panel: <p>Token lifetimes</p> },
              { id: 'activity', label: 'Activity', panel: <p>Audit rows for this client</p> },
            ]}
          />
          <Specimen label="Redirects & origins, while saving">
            <Redirects />
          </Specimen>
          <Specimen label="A save refused with 412: theirs beside yours">
            <Section
              title="Tokens"
              dirty
              saving={false}
              onSave={() => undefined}
              onDiscard={() => undefined}
              blocked="Keep yours or take theirs before saving."
              notice={
                <SectionNotice
                  section="Tokens"
                  status="conflict"
                  conflicts={CONFLICTS}
                  conflictSource="changed"
                  message={null}
                  busy={false}
                  onKeepMine={() => undefined}
                  onTakeTheirs={() => undefined}
                />
              }
            >
              <NumberWithUnitField
                label="Access token lifetime"
                unit="seconds"
                value={600}
                changed
                onChange={() => undefined}
              />
            </Section>
          </Specimen>
          <Specimen label="AuditTable: audit rows, a row opening to every field">
            <AuditTable label="Audit events" rows={EVENTS} now={NOW} withResource />
          </Specimen>
          <Specimen label="AuditDetail: every field of one audit event">
            <AuditDetail event={DETAILED_EVENT} zone="UTC" />
          </Specimen>
          <Specimen label="DateTimeField: a minute in the reader's zone, kept in UTC">
            <DateTimeField
              label="From"
              edge="start"
              zone="UTC"
              value="2026-10-12T09:03:00.000Z"
              onChange={NOTHING}
            />
          </Specimen>
          <Specimen label="ActivityTab: the audit trail for one record">
            <ActivityTab list={listOf(EVENTS, 'c2')} noun="client" now={NOW} />
          </Specimen>
          <Specimen label="ConflictPanel: kept edits meeting a newer record">
            <ConflictPanel
              section="General"
              conflicts={CONFLICTS}
              source="kept"
              onKeepMine={NOTHING}
              onTakeTheirs={NOTHING}
            />
          </Specimen>
          <Specimen label="RecordPage: updated since you opened it">
            <SubjectRecord />
          </Specimen>
          <Specimen label="A field the server refused">
            <SelectField
              label="Password step"
              options={STEP_REQUIREMENTS}
              value="disabled"
              onChange={() => undefined}
              error="The only required step of the flow cannot be disabled."
            />
          </Specimen>
          <Specimen label="RolePicker, GroupPicker and ClientPicker: searched, paged, each role's owner named">
            <Pickers />
          </Specimen>
          <Specimen label="ChecklistField: a set from a short list, each held back with its reason">
            <ChecklistField
              label="Admin capabilities"
              options={[
                {
                  id: 'tenant-admin',
                  label: 'Full (tenant-admin)',
                  description: 'Every capability.',
                },
                {
                  id: 'view-users',
                  label: 'view-users',
                  description: 'Read subjects.',
                  note: 'Also held through group /support.',
                },
                {
                  id: 'manage-keys',
                  label: 'manage-keys',
                  unavailable: 'You do not hold manage-keys, so you cannot give or take it.',
                },
              ]}
              value={['view-users']}
              onChange={() => undefined}
            />
          </Specimen>
          <Specimen label="SaveBar on its own">
            <SaveBar section="Tokens" saving={false} onDiscard={() => undefined} />
          </Specimen>
        </Group>

        <Group id="records" title="Record pages">
          <RecordPieces />
        </Group>

        <Group id="typed" title="Typed fields">
          <Specimen label="Typed fields: a claim in its own shape, with its autocomplete token">
            <TypedFields />
          </Specimen>
          <Specimen label="Profile: a record's claims in columns, one control height">
            <ProfileCloseUp />
          </Specimen>
          <Specimen label="Code and translations: a coloured stylesheet field, and a text in each language">
            <CodeAndTranslations />
          </Specimen>
          <Specimen label="View only: one line, and every field as text">
            <ViewOnly />
          </Specimen>
        </Group>

        <Group id="lists" title="Lists">
          <Lists />
          <Specimen label="ResourceListPage: a whole list, searched, counted and paged">
            <ClientList />
          </Specimen>
        </Group>

        <Group id="feedback" title="Empty, loading and notices">
          <div className={styles.grid}>
            <EmptyState
              variant="nothing-yet"
              title="No clients yet"
              action={<Button variant="primary">Create client</Button>}
            >
              A client is an application people sign in to.
            </EmptyState>
            <EmptyState variant="nothing-matches" title="No subjects match “adx”">
              Search matches the start of a username.
            </EmptyState>
            <EmptyState
              variant="failed"
              title="Clients could not be loaded"
              action={<Button>Retry</Button>}
            >
              The gateway did not answer in time.
            </EmptyState>
            <Skeleton label="Checking access to Clients" lines={4} />
            <ChunkFailed onReload={NOTHING} />
          </div>
          <div className={styles.grid}>
            <Specimen label="FailurePanel: a page that could not be shown; the id, the route and the time are all it carries">
              <FailurePanel
                announced={false}
                kicker="Unexpected error"
                title="Something went wrong"
                messageLabel="Message, shown in a development build only"
                detailsHeading="Quote this when you report the problem"
                detailsLabel="error details"
                text="This page could not be shown. The rest of the console is still here, and anything you had not saved on another page is still held."
                message={null}
                details={FAILURE_DETAILS}
                actions={
                  <>
                    <Button variant="primary">Try again</Button>
                    <Button>Back to overview</Button>
                    <Button>Reload the console</Button>
                  </>
                }
              />
            </Specimen>
          </div>
          <Specimen label="Skeleton: a table, its own header over placeholder rows">
            <TableSkeleton label="Loading clients" columns={COLUMNS} />
          </Specimen>
          <Specimen label="Skeleton: a record, its tabs and sections">
            <RecordSkeleton label="Loading the subject" tabs={['Profile', 'Roles', 'Activity']} />
          </Specimen>
          <div className={styles.grid}>
            <Specimen label="Skeleton: a form">
              <FormSkeleton label="Loading the profile" />
            </Specimen>
            <Specimen label="Skeleton: terms and values">
              <TermsSkeleton label="Loading the discovery document" />
            </Specimen>
            <Specimen label="Skeleton: a list">
              <ListSkeleton label="Loading subjects" />
            </Specimen>
          </div>
        </Group>

        <Group id="dialogs" title="Dialogs">
          <Dialogs initial={initialDialog} />
        </Group>
      </div>
      <Toasts
        toasts={toasts}
        onDismiss={(id) => {
          setToasts((queue) => queue.filter((t) => t.id !== id));
        }}
      />
    </AppShell>
  );
}
