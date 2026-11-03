import { useId } from 'react';
import { areaAt } from '#/entities/area';
import { CapabilityHolders } from '#/features/subjects';
import {
  useSystemAdministratorsPage,
  type SystemAdministrators,
} from '#/features/system-admins/use-cases/useSystemAdministratorsPage';
import { SystemGate } from '#/widgets/shell';
import { nameOrId } from '#/shared/services/ids';
import { firstChosen } from '#/shared/services/picker';
import { SYSTEM_TENANT } from '#/shared/services/principal';
import { Button } from '#/shared/ui/Button';
import { ChecklistField } from '#/shared/ui/ChecklistField';
import { LiveMessage } from '#/shared/ui/Message';
import { PageHeader } from '#/shared/ui/PageHeader';
import { Picker } from '#/shared/ui/Picker';
import { ViewOnlyNote } from '#/shared/ui/ViewOnlyNote';
import styles from '#/features/system-admins/ui/SystemAdministratorsPage/SystemAdministratorsPage.module.css';

const TITLE = areaAt('system-admins').label;

function Add({ page }: { page: SystemAdministrators }) {
  const heading = useId();
  const chosen = page.chosen;
  return (
    <section aria-labelledby={heading} className={styles.grant}>
      <h2 id={heading} className={styles.heading}>
        Add an administrator
      </h2>
      <p className={styles.lead}>
        Give a subject of <code>system</code> what it should hold, or create a new one. Nobody is
        given a password here.
      </p>
      <Picker
        label="Subject in system"
        noun={{ one: 'subject', other: 'subjects' }}
        picker={page.picker}
        idOf={(subject) => subject.id}
        nameOf={nameOrId}
        detailOf={(subject) => subject.email ?? subject.type}
        unavailableOf={page.unavailableOf}
        capability="view-users"
        searchBy="username"
        selected={chosen === null ? [] : [chosen.id]}
        onChange={(ids) => {
          page.choose(firstChosen(ids));
        }}
        selectionMode="single"
      />
      <ChecklistField
        label="What they hold"
        description="Full is every capability, manage-tenants among them. You can give only what you hold."
        options={page.holdingOptions}
        value={page.holdings}
        error={page.holdingsError}
        onChange={page.chooseHoldings}
      />
      <div className={styles.actions}>
        <Button variant="primary" isDisabled={chosen === null || page.busy} onPress={page.grant}>
          {chosen === null ? 'Give it to the chosen subject' : `Give it to ${nameOrId(chosen)}`}
        </Button>
        {page.createNeeds.length > 0 ? null : (
          <Button onPress={page.begin.start}>Create a new subject as an administrator</Button>
        )}
        <LiveMessage label="Last grant">{page.grantMessage}</LiveMessage>
      </div>
    </section>
  );
}

function Administrators() {
  const page = useSystemAdministratorsPage();
  return (
    <>
      <PageHeader
        kicker="System"
        title={TITLE}
        description="Everybody in system who holds an admin capability. manage-tenants, which Full carries here, is what reaches every other tenant; anything else held in system acts in system only. A change that would leave system with no enabled holder of manage-tenants is refused."
      />
      <div className={styles.after}>
        {page.blocked === null ? null : (
          <ViewOnlyNote
            noun="system administrators"
            change={page.blocked.change}
            needs={page.blocked.needs}
          />
        )}
        <CapabilityHolders tenant={SYSTEM_TENANT} canChange={page.changeNeeds.length === 0} />
        {page.changeNeeds.length === 0 ? <Add page={page} /> : null}
      </div>
    </>
  );
}

export function SystemAdministratorsPage({ tenant }: { tenant: string }) {
  return (
    <SystemGate tenant={tenant} title={TITLE}>
      <Administrators />
    </SystemGate>
  );
}
