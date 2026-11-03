import type { InstallationRow } from '#/pages/clients/services/installation';
import { useInstallationPanel } from '#/pages/clients/use-cases/useClientInstallationPanel';
import { Button } from '#/shared/ui/Button';
import { CopyValue } from '#/shared/ui/CopyValue';
import { Panel } from '#/shared/ui/Panel';
import { FormSkeleton } from '#/shared/ui/Skeleton';
import { recordTab } from '#/shared/ui/RecordTab';
import styles from '#/pages/clients/ui/Installation/Installation.module.css';

function Value({ row, none }: { row: InstallationRow; none: string }) {
  if (row.values.length === 0) return <span className={recordTab.rule}>{none}</span>;
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
  const page = useInstallationPanel(tenant, clientDbId);
  const panel = page.read;
  return (
    <Panel title={page.heading}>
      <p className={recordTab.rule}>{page.rule}</p>
      {panel.status === 'loading' ? (
        <FormSkeleton label="Loading the installation" fields={3} />
      ) : null}
      {panel.status === 'failed' ? (
        <div role="alert">
          <p className={recordTab.text}>The installation could not be loaded.</p>
          <Button onPress={panel.retry}>Try again</Button>
        </div>
      ) : null}
      {panel.status === 'ready' ? (
        <dl className={recordTab.fixed}>
          {panel.data.map((row) => (
            <div key={row.label}>
              <dt>{row.label}</dt>
              <dd>
                <Value row={row} none={page.none} />
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </Panel>
  );
}
