import { Link } from 'react-aria-components';
import { CopyValue } from '#/shared/ui/CopyValue';
import { StatusTag } from '#/shared/ui/StatusTag';
import type { AuditEvent } from '#/entities/audit-event/types/auditEvent';
import { auditActorOf } from '#/entities/audit-event/use-cases/auditActorOf';
import styles from '#/entities/audit-event/ui/AuditActor/AuditActor.module.css';

type Actor = Pick<AuditEvent, 'actor_subject_id' | 'actor_name' | 'actor_origin'>;

// The name is resolved when the row is read, and is null to a caller
// without view-users and for a subject since deleted; the id stays, on
// hover and to copy. A caller from elsewhere is marked as such (ADR 0037).
export function AuditActor({ event, href = null }: { event: Actor; href?: string | null }) {
  const id = event.actor_subject_id;
  if (id === null) return <span className={styles.none}>no subject</span>;
  const { name, elsewhere } = auditActorOf(event);
  return (
    <span className={styles.actor}>
      <span className={styles.who}>
        {href !== null && name !== null ? (
          <Link href={href} className={styles.name ?? ''} aria-label={`${name}, open the subject`}>
            <span title={id}>{name}</span>
          </Link>
        ) : (
          <span title={id} className={name === null ? styles.none : styles.name}>
            {name ?? 'name not shown'}
          </span>
        )}
        {elsewhere ? <StatusTag tone="system-authority">from elsewhere</StatusTag> : null}
      </span>
      <CopyValue label="actor subject id" value={id} short />
    </span>
  );
}
