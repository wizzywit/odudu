import type { AuditEvent } from '@odudu/contracts/admin';
import { CopyValue } from '#/shared/view/CopyValue.tsx';
import { StatusTag } from '#/shared/view/StatusTag.tsx';
import styles from '#/shared/view/AuditActor.module.css';

type Actor = Pick<AuditEvent, 'actor_subject_id' | 'actor_name' | 'actor_origin'>;

// The name is resolved when the row is read, and is null to a caller
// without view-users and for a subject since deleted; the id stays, on
// hover and to copy. A caller from elsewhere is marked as such (ADR 0037).
export function AuditActor({ event }: { event: Actor }) {
  const id = event.actor_subject_id;
  if (id === null) return <span className={styles.none}>no subject</span>;
  const elsewhere = event.actor_origin === 'system' || event.actor_origin === 'other-tenant';
  let name = event.actor_name;
  if (event.actor_origin === 'system') name = 'a system administrator';
  if (event.actor_origin === 'other-tenant') name = "another tenant's caller";
  return (
    <span className={styles.actor}>
      <span className={styles.who}>
        <span title={id} className={name === null ? styles.none : styles.name}>
          {name ?? 'name not shown'}
        </span>
        {elsewhere ? <StatusTag tone="system-authority">from elsewhere</StatusTag> : null}
      </span>
      <CopyValue label="actor subject id" value={id} short />
    </span>
  );
}
