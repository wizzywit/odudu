import { Fragment, useId, type ReactNode } from 'react';
import type { PublishedLane } from '#/entities/signing-key';
import { type DiscoveryView } from '#/features/overview/services/discovery';
import { type KeysView, type PublishedKey } from '#/features/overview/services/keys';
import type { OverviewWords } from '#/features/overview/services/overviewWords';
import { type OverviewRead } from '#/features/overview/types/overviewReads';
import { Panel } from '#/features/overview/ui/Panel';
import { CapabilityNote } from '#/shared/ui/CapabilityNote';
import { CopyValue } from '#/shared/ui/CopyValue';
import { DataTable, type Column } from '#/shared/ui/DataTable';
import { LoadFailed } from '#/shared/ui/LoadFailed';
import { TableSkeleton, TermsSkeleton } from '#/shared/ui/Skeleton';
import { StatusTag, type StatusTone } from '#/shared/ui/StatusTag';
import styles from '#/features/overview/ui/DiscoveryPanel/DiscoveryPanel.module.css';

const TONES: Record<PublishedLane, StatusTone> = {
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

type Words = OverviewWords['discovery'];

function Absent({ words }: { words: Words }) {
  return <span className={styles.quiet}>{words.none}</span>;
}

function columns(words: Words): readonly Column<PublishedKey>[] {
  return [
    {
      id: 'kid',
      header: words.columns.kid,
      isRowHeader: true,
      cell: (key) =>
        key.kid === null ? (
          <Absent words={words} />
        ) : (
          <CopyValue label={words.keyIdCopy} value={key.kid} short />
        ),
    },
    { id: 'kty', header: words.columns.kty, cell: (key) => <code>{key.kty}</code> },
    {
      id: 'alg',
      header: words.columns.alg,
      cell: (key) => (key.alg === null ? <Absent words={words} /> : <code>{key.alg}</code>),
    },
    {
      id: 'use',
      header: words.columns.use,
      cell: (key) => (key.use === null ? <Absent words={words} /> : <code>{key.use}</code>),
    },
    {
      id: 'lane',
      header: words.columns.lane,
      cell: (key) =>
        key.lane === 'unknown' ? (
          <span className={styles.quiet}>{words.laneUnknown}</span>
        ) : (
          <StatusTag tone={TONES[key.lane]}>{key.laneLabel}</StatusTag>
        ),
    },
  ];
}

// A discovery name is words joined by underscores; it may break after one,
// never inside a word.
function Name({ name }: { name: string }) {
  const words = name.split('_');
  return (
    <code>
      {words.map((word, index) => (
        <Fragment key={index}>
          {index < words.length - 1 ? `${word}_` : word}
          {index < words.length - 1 ? <wbr /> : null}
        </Fragment>
      ))}
    </code>
  );
}

function Keys({ keys, words }: { keys: OverviewRead<KeysView>; words: Words }) {
  const cols = columns(words);
  switch (keys.status) {
    case 'off':
    case 'loading':
      return <TableSkeleton label={words.keysLoading} columns={cols} rows={2} />;
    case 'failed':
      return <LoadFailed title={words.keysFailedTitle} retry={keys.retry} />;
    case 'ready':
      return (
        <>
          <DataTable
            label={words.keysTable}
            columns={cols}
            rows={keys.data.rows}
            rowKey={(key) => key.row}
          />
          {keys.data.lanesNeed === null ? null : (
            <CapabilityNote capability={keys.data.lanesNeed}>{words.lanesNote}</CapabilityNote>
          )}
          <details className={styles.raw}>
            <summary className={styles.summary}>{words.rawKeys}</summary>
            <CopyValue label={words.rawKeysCopy} value={keys.data.raw} block />
          </details>
        </>
      );
  }
}

function Document({
  view,
  keys,
  words,
}: {
  view: DiscoveryView;
  keys: OverviewRead<KeysView>;
  words: Words;
}) {
  return (
    <>
      <dl className={styles.facts}>
        <div className={styles.fact}>
          <dt>{words.issuer}</dt>
          <dd>
            <CopyValue label={words.issuerCopy} value={view.issuer} />
          </dd>
        </div>
        <div className={styles.fact}>
          <dt>{words.document}</dt>
          <dd>
            <a href={view.document} className={styles.link}>
              {view.document}
            </a>
          </dd>
        </div>
      </dl>
      <Part title={words.endpoints}>
        <dl className={styles.pairs}>
          {view.endpoints.map((endpoint) => (
            <div key={endpoint.name} className={styles.pair}>
              <dt>
                <Name name={endpoint.name} />
              </dt>
              <dd>
                <code className={styles.url}>{endpoint.url}</code>
              </dd>
            </div>
          ))}
        </dl>
      </Part>
      <Part title={words.supported}>
        <dl className={styles.pairs}>
          {view.lists.map((list) => (
            <div key={list.name} className={styles.pair}>
              <dt>
                <Name name={list.name} />
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
                <Name name={flag.name} />
              </dt>
              <dd>{flag.text}</dd>
            </div>
          ))}
        </dl>
      </Part>
      <Part title={words.keys}>
        <Keys keys={keys} words={words} />
      </Part>
      <details className={styles.raw}>
        <summary className={styles.summary}>{words.rawDocument}</summary>
        <CopyValue label={words.rawDocumentCopy} value={view.raw} block />
      </details>
    </>
  );
}

// The tenant's own public documents, as the gateway reads them with the
// public base's authority, so the issuer is the one relying parties see.
export function DiscoveryPanel({
  discovery,
  keys,
  words,
}: {
  discovery: OverviewRead<DiscoveryView>;
  keys: OverviewRead<KeysView>;
  words: Words;
}) {
  let body: ReactNode;
  switch (discovery.status) {
    case 'off':
    case 'loading':
      body = <TermsSkeleton label={words.loading} rows={6} />;
      break;
    case 'failed':
      body = <LoadFailed title={words.failedTitle} retry={discovery.retry} />;
      break;
    case 'ready':
      body = <Document view={discovery.data} keys={keys} words={words} />;
      break;
  }
  return <Panel title={words.title}>{body}</Panel>;
}
