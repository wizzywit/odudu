import type { AuditEvent } from '@odudu/contracts/admin';
import { useId, useState, type ReactNode } from 'react';
import { Link } from 'react-aria-components';
import {
  actorNote,
  detailEntries,
  previewOf,
  requestLabel,
  type DetailEntry,
} from '#/shared/services/auditEvents';
import { formatInZone, localZone } from '#/shared/services/zones';
import { AuditActor } from '#/shared/ui/AuditActor';
import { Button } from '#/shared/ui/Button';
import { CopyValue } from '#/shared/ui/CopyValue';
import { OutcomeTag } from '#/shared/ui/StatusTag';
import styles from '#/shared/ui/AuditDetail/AuditDetail.module.css';

function Row({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className={styles.row}>
      <dt className={styles.term}>{term}</dt>
      <dd className={styles.value}>{children}</dd>
    </div>
  );
}

function Id({ label, value }: { label: string; value: string | null }) {
  if (value === null) return <span className={styles.none}>none</span>;
  return <CopyValue label={label} value={value} />;
}

function Long({ entry }: { entry: DetailEntry }) {
  const [whole, setWhole] = useState(false);
  const { shown, truncated } = previewOf(entry.text);
  return (
    <>
      <span className={styles.text}>{whole ? entry.text : shown}</span>
      {truncated ? (
        <Button
          size="small"
          variant="quiet"
          aria-label={`${whole ? 'Show less of' : 'Show the whole value of'} ${entry.path}`}
          onPress={() => {
            setWhole(!whole);
          }}
        >
          {whole ? 'Show less' : 'Show the whole value'}
        </Button>
      ) : null}
    </>
  );
}

function Detail({ detail }: { detail: AuditEvent['detail'] }) {
  const heading = useId();
  const { entries, omitted } = detailEntries(detail);
  return (
    <section aria-labelledby={heading} className={styles.detail}>
      <h3 id={heading} className={styles.heading}>
        Detail
      </h3>
      {entries.length === 0 ? (
        <p className={styles.none}>No further detail was recorded for this event.</p>
      ) : (
        <>
          {entries.some((entry) => entry.change) ? (
            <p className={styles.hint}>A change reads before → after.</p>
          ) : null}
          <dl className={styles.entries}>
            {entries.map((entry) => (
              <div key={entry.path} className={styles.entry}>
                <dt className={styles.key}>{entry.path}</dt>
                <dd className={styles.text}>
                  <Long entry={entry} />
                </dd>
              </div>
            ))}
          </dl>
          {omitted === 0 ? null : (
            <p className={styles.hint}>{`${String(omitted)} more not shown.`}</p>
          )}
        </>
      )}
    </section>
  );
}

// Every field of an audit event: the stored ids, the time in the reader's
// zone and in UTC, and the redacted detail as keys and values.
export function AuditDetail({
  event,
  zone = localZone(),
  resourceHref = null,
  actorHref = null,
}: {
  event: AuditEvent;
  zone?: string;
  resourceHref?: string | null;
  actorHref?: string | null;
}) {
  const at = new Date(event.occurred_at);
  const note = actorNote(event);
  return (
    <div className={styles.detailView}>
      <dl className={styles.fields}>
        <Row term="Event id">
          <Id label="event id" value={event.id} />
        </Row>
        <Row term="When">
          <span className={styles.text}>{formatInZone(at, zone)}</span>
          <span className={styles.text}>{formatInZone(at, 'UTC')}</span>
        </Row>
        <Row term="Event type">{event.event_type}</Row>
        <Row term="Action">
          <code>{event.action}</code>
        </Row>
        <Row term="Outcome">
          <OutcomeTag outcome={event.outcome} />
        </Row>
        <Row term="Actor">
          <AuditActor event={event} />
          {note === null ? null : <p className={styles.hint}>{note}</p>}
          {actorHref === null ? null : (
            <Link href={actorHref} className={styles.link ?? ''}>
              Open the actor
            </Link>
          )}
        </Row>
        <Row term="Actor tenant">
          <Id label="actor tenant id" value={event.actor_tenant_id} />
        </Row>
        <Row term="Actor client">
          <Id label="actor client id" value={event.actor_client_id} />
        </Row>
        <Row term="Resource type">
          {event.resource_type ?? <span className={styles.none}>none</span>}
        </Row>
        <Row term="Resource id">
          <Id label="resource id" value={event.resource_id} />
          {resourceHref === null ? null : (
            <Link href={resourceHref} className={styles.link ?? ''}>
              {`Open the ${event.resource_type ?? 'resource'}`}
            </Link>
          )}
        </Row>
        <Row term="Request id">
          {event.request_id === null ? (
            <span className={styles.none}>none sent</span>
          ) : (
            <>
              <CopyValue label="request id" value={event.request_id} />
              <p className={styles.hint}>
                {`Label ${requestLabel(event.request_id)}. The caller can set it, so it is a correlation, not evidence.`}
              </p>
            </>
          )}
        </Row>
        <Row term="Address">{event.ip ?? <span className={styles.none}>none</span>}</Row>
      </dl>
      <Detail detail={event.detail} />
    </div>
  );
}
