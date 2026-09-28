import { useState, type ReactNode } from 'react';
import { advance, type CursorTrail } from '#/shared/service/cursorTrail.ts';
import { current, dirtyFields, discard, edit, startDraft } from '#/shared/service/dirty.ts';
import type { Toast } from '#/shared/service/toast.ts';
import { AppShell } from '#/shared/view/AppShell.tsx';
import { Button } from '#/shared/view/Button.tsx';
import { CapabilityNote } from '#/shared/view/CapabilityNote.tsx';
import { ConfirmDialog } from '#/shared/view/ConfirmDialog.tsx';
import { ContextBar } from '#/shared/view/ContextBar.tsx';
import { CopyValue } from '#/shared/view/CopyValue.tsx';
import { Count } from '#/shared/view/Count.tsx';
import { DataTable, type Column } from '#/shared/view/DataTable.tsx';
import { Duration } from '#/shared/view/Duration.tsx';
import { EmptyState } from '#/shared/view/EmptyState.tsx';
import {
  KeyValueField,
  NumberWithUnitField,
  SelectField,
  TextField,
  ToggleField,
  UrlListField,
} from '#/shared/view/Field.tsx';
import { FilterBar } from '#/shared/view/FilterBar.tsx';
import { PageHeader } from '#/shared/view/PageHeader.tsx';
import { Pager } from '#/shared/view/Pager.tsx';
import { Rail } from '#/shared/view/Rail.tsx';
import { SaveBar } from '#/shared/view/SaveBar.tsx';
import { SecretDialog } from '#/shared/view/SecretDialog.tsx';
import { Section } from '#/shared/view/Section.tsx';
import { Skeleton } from '#/shared/view/Skeleton.tsx';
import { StatusTag } from '#/shared/view/StatusTag.tsx';
import { Tabs } from '#/shared/view/Tabs.tsx';
import { Timestamp } from '#/shared/view/Timestamp.tsx';
import { Toasts } from '#/shared/view/Toasts.tsx';
import { UnsavedChangesDialog } from '#/shared/view/UnsavedChangesDialog.tsx';
import styles from '#/gallery/Gallery.module.css';
import {
  CLAIM_VALUES,
  CLIENT_SECRET,
  CLIENTS,
  NOW,
  RAIL_GROUPS,
  REDIRECT_URIS,
  STEP_REQUIREMENTS,
  SUBJECT_FIELDS,
  TENANT,
  type ClientRow,
} from '#/gallery/samples.ts';

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

function Group({
  id,
  title,
  children,
}: {
  readonly id: string;
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={styles.group}>
      <h2 id={`${id}-title`} className={styles.groupTitle}>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Specimen({ label, children }: { readonly label: string; readonly children: ReactNode }) {
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
        label="Clients"
        columns={COLUMNS}
        rows={CLIENTS}
        rowKey={(c) => c.id}
        onRowAction={() => undefined}
      />
      <Pager
        label="Clients"
        trail={trail}
        next="c4"
        onTrailChange={setTrail}
        onLoadMore={() => undefined}
      />
      <div className={styles.counts}>
        <Count count={1204} capped={false} noun={{ one: 'client', other: 'clients' }} />
        <Count count={1} capped={false} noun={{ one: 'group', other: 'groups' }} />
        <Count count={1000} capped noun={{ one: 'role', other: 'roles' }} />
      </div>
    </>
  );
}

function Dialogs({ initial }: { readonly initial: GalleryDialog | null }) {
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

function ThemeChoice({
  theme,
  onChange,
}: {
  readonly theme: GalleryTheme;
  readonly onChange: (theme: GalleryTheme) => void;
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
  theme = 'light',
  onThemeChange = () => undefined,
}: {
  readonly initialDialog?: GalleryDialog | null;
  readonly theme?: GalleryTheme;
  readonly onThemeChange?: (theme: GalleryTheme) => void;
}) {
  const [toasts, setToasts] = useState(TOASTS);
  return (
    <AppShell
      rail={
        <Rail
          label="Tenant areas"
          groups={RAIL_GROUPS}
          currentHref="#editing"
          header={<strong className={styles.brand}>odudu · {TENANT}</strong>}
          footer={<span className={styles.railFooter}>ada@acme.example</span>}
        />
      }
      contextBar={<ContextBar tenant={TENANT} />}
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
          <Specimen label="StatusTag">
            <div className={styles.row}>
              <StatusTag tone="active">active</StatusTag>
              <StatusTag tone="warning">rotating</StatusTag>
              <StatusTag tone="danger">locked out</StatusTag>
              <StatusTag>retired</StatusTag>
              <StatusTag tone="system-authority">system</StatusTag>
            </div>
          </Specimen>
          <Specimen label="CopyValue">
            <div className={styles.stack}>
              <CopyValue label="issuer" value="https://id.acme.example/acme" />
              <CopyValue label="client id" value={CLIENTS[0]?.id ?? ''} short />
            </div>
          </Specimen>
          <Specimen label="Timestamp · Duration · Count">
            <div className={styles.stack}>
              <Timestamp value="2026-09-28T13:41:05Z" now={NOW} />
              <Duration seconds={1209600} />
              <Count count={10000} capped noun={{ one: 'subject', other: 'subjects' }} />
            </div>
          </Specimen>
          <Specimen label="CapabilityNote">
            <CapabilityNote capability="manage-clients">Rotating a secret</CapabilityNote>
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
          <Specimen label="A field the server refused">
            <SelectField
              label="Password step"
              options={STEP_REQUIREMENTS}
              value="disabled"
              onChange={() => undefined}
              error="The only required step of the flow cannot be disabled."
            />
          </Specimen>
          <Specimen label="SaveBar on its own">
            <SaveBar section="Tokens" saving={false} onDiscard={() => undefined} />
          </Specimen>
        </Group>

        <Group id="lists" title="Lists">
          <Lists />
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
            <Skeleton label="Loading clients" lines={4} />
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
