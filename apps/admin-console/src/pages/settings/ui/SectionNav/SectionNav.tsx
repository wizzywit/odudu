import { useEffect, useState } from 'react';
import { currentSection, type NavGroup } from '#/pages/settings/services/sectionPlan';
import { sectionHeadingId } from '#/pages/settings/services/sections';
import { VisuallyHidden } from '#/shared/ui/VisuallyHidden';
import styles from '#/pages/settings/ui/SectionNav/SectionNav.module.css';

// A heading reaches the reading band near the top of the screen when its
// section has scrolled to it, whatever the height of the section.
const BAND = '-12% 0px -78% 0px';

function useCurrent(key: string) {
  const [current, setCurrent] = useState<string | null>(null);
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const order = key.split(' ');
    const ids = new Map<Element, string>();
    const inBand = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = ids.get(entry.target) ?? '';
          if (entry.isIntersecting) inBand.add(id);
          else inBand.delete(id);
        }
        setCurrent((last) => currentSection(order, inBand, last));
      },
      { rootMargin: BAND },
    );
    for (const id of order) {
      const section = document.getElementById(sectionHeadingId(id))?.closest('section');
      if (section === null || section === undefined) continue;
      ids.set(section, id);
      observer.observe(section);
    }
    return () => {
      observer.disconnect();
    };
  }, [key]);
  return current;
}

function go(headingId: string): void {
  const heading = document.getElementById(headingId);
  if (heading === null) return;
  heading.focus();
  globalThis.history.replaceState(globalThis.history.state, '', `#${headingId}`);
}

export function SectionNav({ label, groups }: { label: string; groups: readonly NavGroup[] }) {
  const items = groups.flatMap((group) => group.items);
  const current = useCurrent(items.map((item) => item.id).join(' '));
  return (
    <nav aria-label={label} className={styles.nav}>
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
                      <VisuallyHidden> (unsaved changes)</VisuallyHidden>
                    </>
                  ) : null}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
