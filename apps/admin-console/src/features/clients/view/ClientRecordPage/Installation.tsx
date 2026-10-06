import { useId } from 'react';
import {
  INSTALLATION_HEADING,
  INSTALLATION_RULE,
  NONE,
  type InstallationRow,
} from '#/features/clients/service';
import { useInstallationPanel } from '#/features/clients/usecase/useClientInstallationPanel.ts';
import { Button } from '#/shared/view/Button';
import { CopyValue } from '#/shared/view/CopyValue';
import { FormSkeleton } from '#/shared/view/Skeleton';
import styles from '#/features/clients/view/ClientRecordPage/Tab.module.css';

function Value({ row }: { row: InstallationRow }) {
  if (row.values.length === 0) return <span className={styles.rule}>{NONE}</span>;
  if (row.copy) {
    return (
      <>
        {row.values.map((value) => (
          <CopyValue key={value} label={row.label.toLowerCase()} value={value} />
        ))}
      </>
    );
  }
  return (
    <ul className={styles.values}>
      {row.values.map((value) => (
        <li key={value}>
          <code>{value}</code>
        </li>
      ))}
    </ul>
  );
}

export function Installation({ tenant, clientDbId }: { tenant: string; clientDbId: string }) {
  const heading = useId();
  const panel = useInstallationPanel(tenant, clientDbId);
  return (
    <section aria-labelledby={heading} className={styles.panel}>
      <h2 id={heading} className={styles.heading}>
        {INSTALLATION_HEADING}
      </h2>
      <p className={styles.rule}>{INSTALLATION_RULE}</p>
      {panel.status === 'loading' ? (
        <FormSkeleton label="Loading the installation" fields={3} />
      ) : null}
      {panel.status === 'failed' ? (
        <div role="alert">
          <p className={styles.text}>The installation could not be loaded.</p>
          <Button onPress={panel.retry}>Try again</Button>
        </div>
      ) : null}
      {panel.status === 'ready' ? (
        <dl className={styles.fixed}>
          {panel.rows.map((row) => (
            <div key={row.label}>
              <dt>{row.label}</dt>
              <dd>
                <Value row={row} />
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </section>
  );
}
