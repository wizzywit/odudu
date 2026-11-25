import { Link } from 'react-aria-components';
import { CopyValue } from '#/shared/ui/CopyValue';
import styles from '#/pages/agents/ui/OwnerLink/OwnerLink.module.css';

// The person an agent acts for: their name, linked to their record where the
// caller may read it, and the id beside it to copy. With no name the id stands
// alone.
export function OwnerLink({
  id,
  name,
  href,
  linkLabel,
  copyLabel,
}: {
  id: string;
  name: string | null;
  href: string | undefined;
  linkLabel: string;
  copyLabel: string;
}) {
  return (
    <span className={styles.owner}>
      {name === null ? null : href === undefined ? (
        <span className={styles.name}>{name}</span>
      ) : (
        <Link href={href} className={styles.link ?? ''} aria-label={linkLabel}>
          {name}
        </Link>
      )}
      <CopyValue label={copyLabel} value={id} short />
    </span>
  );
}
