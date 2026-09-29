import { Link } from 'react-aria-components';
import type { Crumb } from '#/shared/service/breadcrumb.ts';
import styles from '#/shared/view/Breadcrumb.module.css';

export type { Crumb };

// The last step is the page itself. A narrow shell shows only the way up,
// to the nearest step before it that has an address.
export function Breadcrumb({
  items,
  label = 'Breadcrumb',
}: {
  readonly items: readonly Crumb[];
  // Only where two trails share a page, as the gallery's do.
  label?: string;
}) {
  const up = items
    .slice(0, -1)
    .reverse()
    .find((item) => item.href !== undefined);
  const last = items.length - 1;
  return (
    <nav aria-label={label} className={styles.nav}>
      <ol className={styles.trail}>
        {items.map((item, index) => (
          <li key={`${String(index)}:${item.label}`} className={styles.step}>
            {index === last ? (
              <span aria-current="page" className={styles.current}>
                {item.label}
              </span>
            ) : item.href === undefined ? (
              <span className={styles.group}>{item.label}</span>
            ) : (
              <Link href={item.href} className={styles.link ?? ''}>
                {item.label}
              </Link>
            )}
            {index === last ? null : (
              <span aria-hidden="true" className={styles.separator}>
                ›
              </span>
            )}
          </li>
        ))}
      </ol>
      {up?.href === undefined ? null : (
        <Link href={up.href} aria-label={`Back to ${up.label}`} className={styles.up ?? ''} data-up>
          <span aria-hidden="true">‹</span> {up.label}
        </Link>
      )}
    </nav>
  );
}
