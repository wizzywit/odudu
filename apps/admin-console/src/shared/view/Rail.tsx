import { useId, type ReactNode } from 'react';
import { Link } from 'react-aria-components';
import styles from '#/shared/view/Rail.module.css';

export interface RailItem {
  href: string;
  label: string;
}

export interface RailGroup {
  heading?: string;
  items: readonly RailItem[];
}

function Group({ group, currentHref }: { group: RailGroup; currentHref?: string }) {
  const id = useId();
  const named = group.heading !== undefined;
  return (
    <div className={styles.group}>
      {named ? (
        <p id={id} className={styles.heading}>
          {group.heading}
        </p>
      ) : null}
      <ul className={styles.items} {...(named ? { 'aria-labelledby': id } : {})}>
        {group.items.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              className={styles.link ?? ''}
              {...(item.href === currentHref ? { 'aria-current': 'page' as const } : {})}
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Rail({
  label,
  groups,
  currentHref,
  header,
  footer,
  checking = false,
}: {
  label: string;
  groups: readonly RailGroup[];
  currentHref?: string;
  // Whether the areas it may list are still being asked about.
  checking?: boolean;
  header?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <nav aria-label={label} className={styles.rail}>
      {header === undefined ? null : <div className={styles.header}>{header}</div>}
      <div className={styles.groups}>
        {groups.map((group, index) => (
          <Group
            key={group.heading ?? `group-${String(index)}`}
            group={group}
            {...(currentHref === undefined ? {} : { currentHref })}
          />
        ))}
        {checking ? (
          <div className={styles.checking}>
            <p role="status" className={styles.checkingLabel}>
              Checking which areas you can reach
            </p>
            <span aria-hidden="true" className={styles.checkingBars}>
              {[0, 1, 2, 3].map((bar) => (
                <span key={bar} className={styles.checkingBar} />
              ))}
            </span>
          </div>
        ) : null}
      </div>
      {footer === undefined ? null : <div className={styles.footer}>{footer}</div>}
    </nav>
  );
}

// The rail's place held while its contents are not known: the header and
// bars where the groups will be, drawn and never read out.
export function RailSkeleton({ header }: { header?: ReactNode }) {
  return (
    <div className={styles.rail}>
      {header === undefined ? null : <div className={styles.header}>{header}</div>}
      <div className={styles.groups}>
        <span aria-hidden="true" className={styles.checkingBars}>
          {[0, 1, 2, 3, 4, 5].map((bar) => (
            <span key={bar} className={styles.checkingBar} />
          ))}
        </span>
      </div>
    </div>
  );
}
