import {
  INSTALLATION_HEADING,
  INSTALLATION_RULE,
  NONE,
  type InstallationRow,
} from '#/features/clients/services';
import { useInstallationPanel } from '#/features/clients/use-cases/useClientInstallationPanel';
import { Button } from '#/shared/ui/Button';
import { CopyValue } from '#/shared/ui/CopyValue';
import { Panel } from '#/shared/ui/Panel';
import { FormSkeleton } from '#/shared/ui/Skeleton';
import { recordTab } from '#/shared/ui/RecordTab';
import styles from '#/features/clients/ui/Installation/Installation.module.css';

function Value({ row }: { row: InstallationRow }) {
  if (row.values.length === 0) return <span className={recordTab.rule}>{NONE}</span>;
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
  const panel = useInstallationPanel(tenant, clientDbId);
  return (
    <Panel title={INSTALLATION_HEADING}>
      <p className={recordTab.rule}>{INSTALLATION_RULE}</p>
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
                <Value row={row} />
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </Panel>
  );
}
