import type { Client, ClientScope } from '@odudu/contracts/admin';
import { useId, useRef } from 'react';
import {
  ASSIGN_HEADING,
  ASSIGN_LABEL,
  ASSIGNED_HEADING,
  ASSIGNMENT_RULE,
  ASSIGNMENTS,
  NO_SCOPES,
  PICKER_LABEL,
  type Reach,
} from '#/features/clients/service';
import {
  useClientScopeAssignment,
  type ClientScopes,
} from '#/features/clients/usecase/useClientScopeAssignment.ts';
import { Button } from '#/shared/view/Button';
import { InlineFields, SelectField } from '#/shared/view/Field';
import { Picker } from '#/shared/view/Picker';
import { ViewOnlyNote } from '#/shared/view/ViewOnlyNote';
import styles from '#/features/clients/view/ClientRecordPage/Tab.module.css';

function Assigned({ client, page }: { client: Client; page: ClientScopes }) {
  const heading = useId();
  const title = useRef<HTMLHeadingElement>(null);
  // A removed row takes the focus that was on it, so the heading holds it.
  const removed = async (scope: Client['scopes'][number]): Promise<void> => {
    if (await page.remove(scope)) title.current?.focus();
  };
  return (
    <section aria-labelledby={heading} className={styles.panel}>
      <h2 id={heading} ref={title} tabIndex={-1} className={styles.heading}>
        {ASSIGNED_HEADING}
      </h2>
      <p className={styles.rule}>{`${ASSIGNMENT_RULE} ${page.count}`}</p>
      {page.fixed === null ? null : <p className={styles.rule}>{page.fixed}</p>}
      {page.shown.length === 0 ? (
        <p className={styles.text}>{NO_SCOPES}</p>
      ) : (
        <ul aria-label={`Scopes assigned to ${client.name}`} className={styles.scopes}>
          {page.shown.map((scope) => (
            <li key={scope.id} className={styles.scope}>
              <code>{scope.name}</code>
              {page.offered ? (
                <InlineFields>
                  <SelectField
                    label={`Assignment of ${scope.name}`}
                    hideLabel
                    options={ASSIGNMENTS}
                    value={scope.assignment}
                    isDisabled={page.working !== null}
                    onChange={(value) => {
                      page.change(scope, value).catch(() => undefined);
                    }}
                  />
                </InlineFields>
              ) : (
                <span>{scope.assignment}</span>
              )}
              {page.offered && page.fixed === null ? (
                <Button
                  size="small"
                  variant="quiet"
                  isDisabled={page.working !== null}
                  aria-label={`Remove ${scope.name}`}
                  onPress={() => {
                    removed(scope).catch(() => undefined);
                  }}
                >
                  Remove
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {page.more > 0 ? (
        <div className={styles.actions}>
          <Button size="small" onPress={page.showMore}>
            {`Show ${String(page.more)} more`}
          </Button>
        </div>
      ) : null}
      {page.message === null ? null : (
        <p role="alert" className={styles.message}>
          {page.message}
        </p>
      )}
    </section>
  );
}

function Assign({ page }: { page: ClientScopes }) {
  const heading = useId();
  return (
    <section aria-labelledby={heading} className={styles.panel}>
      <h2 id={heading} className={styles.heading}>
        {ASSIGN_HEADING}
      </h2>
      <Picker<ClientScope>
        label={PICKER_LABEL}
        noun={{ one: 'scope', other: 'scopes' }}
        picker={page.picker}
        idOf={(scope) => scope.id}
        nameOf={(scope) => scope.name}
        detailOf={(scope) => scope.description ?? ''}
        unavailableOf={page.unavailableOf}
        capability="manage-tenant"
        selected={page.chosen === null ? [] : [page.chosen.id]}
        selectionMode="single"
        onChange={page.choose}
      />
      <SelectField
        label="Assign it as"
        options={ASSIGNMENTS}
        value={page.assignment}
        onChange={page.setAssignment}
      />
      <div className={styles.actions}>
        <Button
          variant="primary"
          isDisabled={page.chosen === null || page.working !== null}
          onPress={() => {
            page.assign().catch(() => undefined);
          }}
        >
          {page.chosen === null ? ASSIGN_LABEL : `${ASSIGN_LABEL} ${page.chosen.name}`}
        </Button>
      </div>
    </section>
  );
}

export function ScopesTab({
  tenant,
  client,
  reach,
}: {
  tenant: string;
  client: Client;
  reach: Reach;
}) {
  const page = useClientScopeAssignment({ tenant, client, reach });
  return (
    <div className={styles.tab}>
      {page.needs.length > 0 ? (
        <ViewOnlyNote noun="this client's scopes" needs={page.needs} />
      ) : null}
      <Assigned client={client} page={page} />
      {page.offered ? <Assign page={page} /> : null}
    </div>
  );
}
