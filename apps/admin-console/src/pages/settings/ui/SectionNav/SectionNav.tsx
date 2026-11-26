import type { NavGroup } from '#/pages/settings/services/sectionPlan';
import { VisuallyHidden } from '#/shared/ui/VisuallyHidden';
import styles from '#/pages/settings/ui/SectionNav/SectionNav.module.css';

function go(headingId: string): void {
  const heading = document.getElementById(headingId);
  if (heading === null) return;
  heading.focus();
  globalThis.history.replaceState(globalThis.history.state, '', `#${headingId}`);
}

export function SectionNav({
  label,
  unsavedLabel,
  groups,
  current,
}: {
  label: string;
  // Read after the name of a section holding unsaved edits.
  unsavedLabel: string;
  groups: readonly NavGroup[];
  // The id of the section in view.
  current: string | null;
}) {
  return (
    <nav aria-label={label} className={styles.nav}>
      <div className={styles.strip}>
        {groups.map((group) => (
          <div key={group.title} className={styles.group}>
            <p className={styles.groupTitle}>{group.title}</p>
            <ul className={styles.items}>
              {group.items.map((item) => (
                <li key={item.id}>
                  <a
                    href={`#${item.headingId}`}
                    className={styles.link}
                    aria-current={current === item.id ? 'location' : undefined}
                    data-dirty={item.dirty || undefined}
                    onClick={(event) => {
                      event.preventDefault();
                      go(item.headingId);
                    }}
                  >
                    {item.title}
                    {item.dirty ? (
                      <>
                        <span className={styles.dot} aria-hidden="true" />
                        <VisuallyHidden>{unsavedLabel}</VisuallyHidden>
                      </>
                    ) : null}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}
