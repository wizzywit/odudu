import { useId, type ReactNode } from 'react';
import type {
  DiscoveryView,
  KeyLane,
  KeysView,
  PublishedKey,
  Read,
} from '#/features/overview/service.ts';
import { Panel } from '#/features/overview/view/Panel.tsx';
import { Button } from '#/shared/view/Button.tsx';
import { CapabilityNote } from '#/shared/view/CapabilityNote.tsx';
import { CopyValue } from '#/shared/view/CopyValue.tsx';
import { DataTable, type Column } from '#/shared/view/DataTable.tsx';
import { EmptyState } from '#/shared/view/EmptyState.tsx';
import { Skeleton } from '#/shared/view/Skeleton.tsx';
import { StatusTag, type StatusTone } from '#/shared/view/StatusTag.tsx';
import styles from '#/features/overview/view/DiscoveryPanel.module.css';

const TONES: Record<KeyLane, StatusTone> = {
  active: 'active',
  rotating: 'neutral',
  retired: 'danger',
  unlisted: 'warning',
  unknown: 'neutral',
};

function Part({ title, children }: { title: string; children: ReactNode }) {
  const heading = useId();
  return (
    <section aria-labelledby={heading} className={styles.part}>
      <h3 id={heading} className={styles.heading}>
        {title}
      </h3>
      {children}
    </section>
  );
}

function Absent() {
  return <span className={styles.quiet}>none</span>;
}

const COLUMNS: readonly Column<PublishedKey>[] = [
  {
    id: 'kid',
    header: 'Key id',
    isRowHeader: true,
    cell: (key) =>
      key.kid === null ? <Absent /> : <CopyValue label="key id" value={key.kid} short />,
  },
  { id: 'kty', header: 'Type', cell: (key) => <code>{key.kty}</code> },
  {
    id: 'alg',
    header: 'Algorithm',
    cell: (key) => (key.alg === null ? <Absent /> : <code>{key.alg}</code>),
  },
  {
    id: 'use',
    header: 'Use',
    cell: (key) => (key.use === null ? <Absent /> : <code>{key.use}</code>),
  },
  {
    id: 'lane',
    header: 'Lane',
    cell: (key) =>
      key.lane === 'unknown' ? (
        <span className={styles.quiet}>not known</span>
      ) : (
        <StatusTag tone={TONES[key.lane]}>
          {key.lane === 'unlisted' ? 'not in the key list' : key.lane}
        </StatusTag>
      ),
  },
];

function Failed({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <EmptyState
      variant="failed"
      title={`The ${what} could not be read`}
      action={<Button onPress={onRetry}>Try again</Button>}
    >
      The gateway did not answer, or answered with an error.
    </EmptyState>
  );
}

function Keys({ keys }: { keys: Read<KeysView> }) {
  switch (keys.status) {
    case 'off':
    case 'loading':
      return <Skeleton label="Loading the published keys" lines={2} />;
    case 'failed':
      return <Failed what="JWKS" onRetry={keys.retry} />;
    case 'ready':
      return (
        <>
          <DataTable
            label="Published keys"
            columns={COLUMNS}
            rows={keys.data.rows}
            rowKey={(key) => key.row}
          />
          {keys.data.lanesNeed === null ? null : (
            <CapabilityNote capability={keys.data.lanesNeed}>Each key&apos;s lane</CapabilityNote>
          )}
          <details className={styles.raw}>
            <summary className={styles.summary}>Raw JWKS</summary>
            <CopyValue label="JWKS" value={keys.data.raw} block />
          </details>
        </>
      );
  }
}

function Document({ view, keys }: { view: DiscoveryView; keys: Read<KeysView> }) {
  return (
    <>
      <dl className={styles.facts}>
        <div className={styles.fact}>
          <dt>Issuer</dt>
          <dd>
            <CopyValue label="issuer" value={view.issuer} />
          </dd>
        </div>
        <div className={styles.fact}>
          <dt>Discovery document</dt>
          <dd>
            <a href={view.document} className={styles.link}>
              {view.document}
            </a>
          </dd>
        </div>
      </dl>
      <Part title="Endpoints">
        <dl className={styles.pairs}>
          {view.endpoints.map((endpoint) => (
            <div key={endpoint.name} className={styles.pair}>
              <dt>
                <code>{endpoint.name}</code>
              </dt>
              <dd>
                <code className={styles.url}>{endpoint.url}</code>
              </dd>
            </div>
          ))}
        </dl>
      </Part>
      <Part title="Supported values">
        <dl className={styles.pairs}>
          {view.lists.map((list) => (
            <div key={list.name} className={styles.pair}>
              <dt>
                <code>{list.name}</code>
              </dt>
              <dd>
                <ul aria-label={list.name} className={styles.values}>
                  {list.values.map((value) => (
                    <li key={value}>
                      <code>{value}</code>
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
          ))}
          {view.flags.map((flag) => (
            <div key={flag.name} className={styles.pair}>
              <dt>
                <code>{flag.name}</code>
              </dt>
              <dd>{flag.value ? 'yes' : 'no'}</dd>
            </div>
          ))}
        </dl>
      </Part>
      <Part title="Published keys">
        <Keys keys={keys} />
      </Part>
      <details className={styles.raw}>
        <summary className={styles.summary}>Raw discovery document</summary>
        <CopyValue label="discovery document" value={view.raw} block />
      </details>
    </>
  );
}

// The tenant's own public documents, as the gateway reads them with the
// public base's authority, so the issuer is the one relying parties see.
export function DiscoveryPanel({
  discovery,
  keys,
}: {
  discovery: Read<DiscoveryView>;
  keys: Read<KeysView>;
}) {
  let body: ReactNode;
  switch (discovery.status) {
    case 'off':
    case 'loading':
      body = <Skeleton label="Loading the discovery document" lines={4} />;
      break;
    case 'failed':
      body = <Failed what="discovery document" onRetry={discovery.retry} />;
      break;
    case 'ready':
      body = <Document view={discovery.data} keys={keys} />;
      break;
  }
  return <Panel title="Discovery">{body}</Panel>;
}
