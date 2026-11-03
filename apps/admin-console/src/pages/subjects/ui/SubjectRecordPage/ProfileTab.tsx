import type { Profile } from '#/pages/subjects/types/profile';
import { Link } from 'react-aria-components';
import {
  useSubjectAccount,
  type SubjectAccount,
} from '#/pages/subjects/use-cases/useSubjectAccount';
import type { ClaimField } from '#/pages/subjects/services/claims';
import {
  useSubjectClaims,
  useSubjectProfileRead,
  type ClaimSection,
} from '#/pages/subjects/use-cases/useSubjectProfile';
import { Button } from '#/shared/ui/Button';
import { ConfirmDialog } from '#/shared/ui/ConfirmDialog';
import { BirthdateField } from '#/shared/ui/Field';
import { CountryField, GenderField, LocaleField, TimeZoneField } from '#/shared/ui/Field';
import { OwnDataFields, TextField, ToggleField, type Chrome } from '#/shared/ui/Field';
import { FieldGrid, GridCell } from '#/shared/ui/FieldGrid';
import { PhoneField } from '#/shared/ui/Field';
import { PictureField, UrlField } from '#/shared/ui/Field';
import { LiveMessage } from '#/shared/ui/Message';
import { Panel } from '#/shared/ui/Panel';
import { ReadGate } from '#/shared/ui/ReadGate';
import { SaveSection } from '#/shared/ui/SaveSection';
import { EnabledTag } from '#/shared/ui/StatusTag';
import { Timestamp } from '#/shared/ui/Timestamp';
import { recordTab } from '#/shared/ui/RecordTab';
import { type Subject } from '#/entities/subject';

interface TabProps {
  tenant: string;
  subject: Subject;
  etag: string;
  gone: boolean;
  canManage: boolean;
  self: boolean;
}

function Username({ account }: { account: SubjectAccount }) {
  const s = account.section;
  const mode = account.username;
  if (mode.kind === 'editable') {
    return (
      <TextField
        label="Username"
        description={mode.description}
        value={s.values.username}
        error={s.fieldErrors.username}
        changed={s.changed.includes('username')}
        autoComplete="username"
        mono
        onChange={(value) => {
          s.edit('username', value);
        }}
      />
    );
  }
  return (
    <dl className={recordTab.fixed}>
      <dt>Username</dt>
      <dd>
        <code>{s.values.username}</code>
      </dd>
      {mode.kind === 'fixed' ? (
        <dd className={recordTab.rule}>
          {mode.reason} <Link href={mode.settingsHref}>Settings</Link>.
        </dd>
      ) : null}
      {mode.kind === 'failed' ? (
        <dd className={recordTab.rule}>
          Whether this username can be renamed could not be read, so it is not offered.{' '}
          <Button size="small" variant="quiet" onPress={mode.retry}>
            Check again
          </Button>
        </dd>
      ) : null}
    </dl>
  );
}

function Account({ account }: { account: SubjectAccount }) {
  const s = account.section;
  return (
    <SaveSection
      title="Account"
      description="How the subject signs in and is written to. A changed email is unverified until it is proved or marked verified below."
      save={s}
    >
      <Username account={account} />
      <TextField
        label="Email"
        description={account.descriptionRule}
        type="email"
        value={s.values.email}
        error={s.fieldErrors.email}
        changed={s.changed.includes('email')}
        autoComplete="email"
        onChange={(value) => {
          s.edit('email', value);
        }}
      />
    </SaveSection>
  );
}

function Status({ account, self }: { account: SubjectAccount; self: boolean }) {
  const { name } = account;
  return (
    <Panel title="Status">
      <p className={recordTab.text}>
        <EnabledTag enabled={account.enabled} />{' '}
        {account.enabled ? `${name} can sign in.` : `${name} cannot sign in until enabled again.`}
      </p>
      <div className={recordTab.actions}>
        {/* One button whose label turns, so focus stays on it across the change. */}
        <Button
          variant={account.enabled ? 'danger' : 'secondary'}
          isDisabled={account.disable.busy}
          onPress={account.enabled ? account.disable.ask : account.enable}
        >
          {account.enabled
            ? `Disable ${name}`
            : account.disable.busy
              ? 'Enabling…'
              : `Enable ${name}`}
        </Button>
      </div>
      <LiveMessage>{account.enabledMessage}</LiveMessage>
      <ConfirmDialog
        isOpen={account.disable.confirming}
        title={self ? 'Disable your own subject?' : `Disable ${name}?`}
        consequence={
          self
            ? `You are disabling ${name}, the subject you are signed in as. Once it lands you cannot sign in again, and this console session ends at its next request, since the admin API refuses a disabled subject’s token. Somebody else has to enable you.`
            : `${name} can no longer sign in. Enabling them again undoes this.`
        }
        confirmLabel={`Disable ${name}`}
        tone="danger"
        busy={account.disable.busy}
        problem={account.disable.problem}
        onConfirm={account.disable.confirm}
        onCancel={account.disable.cancel}
      />
    </Panel>
  );
}

function Deletion({
  account,
  self,
  refusal,
}: {
  account: SubjectAccount;
  self: boolean;
  refusal: string | null;
}) {
  const { name } = account;
  if (refusal !== null) {
    return (
      <Panel title="Delete">
        <p className={recordTab.text}>{refusal}</p>
      </Panel>
    );
  }
  return (
    <Panel title="Delete">
      <p className={recordTab.text}>
        Deleting removes the subject with everything that names it: credentials, sessions, grants,
        roles and group memberships. It cannot be undone; disabling can.
      </p>
      <div className={recordTab.actions}>
        <Button variant="danger" onPress={account.remove.ask}>
          {`Delete ${name}`}
        </Button>
      </div>
      <ConfirmDialog
        isOpen={account.remove.confirming}
        title={self ? 'Delete your own account?' : `Delete ${name}?`}
        consequence={
          self
            ? `This is your own account, the one you are signed in as. Deleting ${name} ends your console session at once, and it cannot be undone: every credential, session, grant, role and group membership goes with it.`
            : `${name} is removed with every credential, session, grant, role and group membership they hold. Nothing brings them back.`
        }
        confirmLabel={`Delete ${name}`}
        tone="danger"
        typed={name}
        busy={account.remove.busy}
        problem={account.remove.problem}
        onConfirm={account.remove.confirm}
        onCancel={account.remove.cancel}
      />
    </Panel>
  );
}

type ClaimProps = Chrome & { value: string; onChange: (value: string) => void };

function ClaimInput({ claim, ...props }: ClaimProps & { claim: ClaimField }) {
  switch (claim.input) {
    case 'text':
      return (
        <TextField
          {...props}
          {...(claim.autoComplete === undefined ? {} : { autoComplete: claim.autoComplete })}
        />
      );
    case 'url':
      return <UrlField {...props} />;
    case 'picture':
      return <PictureField {...props} />;
    case 'phone':
      return <PhoneField {...props} />;
    case 'birthdate':
      return <BirthdateField {...props} />;
    case 'gender':
      return <GenderField {...props} />;
    case 'zone':
      return <TimeZoneField {...props} />;
    case 'locale':
      return <LocaleField {...props} />;
    case 'country':
      return <CountryField {...props} />;
  }
}

function Claims({ section }: { section: ClaimSection }) {
  const s = section.save;
  return (
    <SaveSection title={section.title} save={s}>
      <FieldGrid>
        {section.claims.map((claim) => (
          <GridCell key={claim.id} {...(claim.span === undefined ? {} : { span: claim.span })}>
            <ClaimInput
              claim={claim}
              label={claim.label}
              value={s.values[claim.id] ?? ''}
              error={s.fieldErrors[claim.id]}
              changed={s.changed.includes(claim.id)}
              onChange={(value) => {
                s.edit(claim.id, value);
              }}
            />
          </GridCell>
        ))}
      </FieldGrid>
    </SaveSection>
  );
}

function ProfileSections({
  tenant,
  id,
  profile,
  etag,
  gone,
}: {
  tenant: string;
  id: string;
  profile: Profile;
  etag: string;
  gone: boolean;
}) {
  const {
    sections,
    verification: v,
    updatedAt,
  } = useSubjectClaims(tenant, id, profile, etag, gone);
  return (
    <>
      {sections.map((section) => (
        <Claims key={section.id} section={section} />
      ))}
      <SaveSection
        title="Verification"
        description="Whether the email and the phone number are proved to be the subject's. A relying party reads these as email_verified and phone_number_verified."
        save={v}
      >
        <ToggleField
          label="Email verified"
          value={v.values.email_verified}
          error={v.fieldErrors.email_verified}
          changed={v.changed.includes('email_verified')}
          onChange={(value) => {
            v.edit('email_verified', value);
          }}
        />
        <ToggleField
          label="Phone number verified"
          description="A verified phone number must be in E.164 form, such as +14155550100."
          value={v.values.phone_number_verified}
          error={v.fieldErrors.phone_number_verified}
          changed={v.changed.includes('phone_number_verified')}
          onChange={(value) => {
            v.edit('phone_number_verified', value);
          }}
        />
      </SaveSection>
      <dl className={recordTab.fixed}>
        <dt>Profile last updated</dt>
        <dd>{updatedAt === null ? 'Never' : <Timestamp value={updatedAt} />}</dd>
      </dl>
    </>
  );
}

function ProfilePanel({ tenant, id }: { tenant: string; id: string }) {
  const read = useSubjectProfileRead(tenant, id);
  return (
    <ReadGate
      read={read}
      label="Loading the profile"
      fields={4}
      failed="The profile could not be loaded"
    >
      {(data, etag) => (
        <ProfileSections tenant={tenant} id={id} profile={data} etag={etag} gone={read.gone} />
      )}
    </ReadGate>
  );
}

export function ProfileTab({ tenant, subject, etag, gone, canManage, self }: TabProps) {
  const account = useSubjectAccount(tenant, subject, etag, gone, self);
  // The tokens describe the operator, so only their own record carries them.
  return (
    <OwnDataFields when={self}>
      <div className={recordTab.tab}>
        {account.itself ? (
          <p className={recordTab.text}>
            {`A ${subject.type} subject has no username, email or profile: it signs in as itself, with its client's credentials.`}
          </p>
        ) : (
          <>
            <Account account={account} />
            <ProfilePanel tenant={tenant} id={subject.id} />
          </>
        )}
        {canManage ? (
          <>
            <Status account={account} self={self} />
            <Deletion account={account} self={self} refusal={account.deletionRefusal} />
          </>
        ) : null}
      </div>
    </OwnDataFields>
  );
}
