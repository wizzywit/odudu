import { DocsLink } from '@site/src/shared/ui/DocsLink/DocsLink';
import { JOURNEYS } from '@site/nav';
import { homeMapSections } from '@site/src/features/docs-home/services/homeMap';
import type { ReactNode } from 'react';
import { classNames } from '@site/src/shared/services/classNames';
import styles from '@site/src/features/docs-home/ui/HomeMap/HomeMap.module.css';

const LOOKS = { primary: styles.primary, plain: undefined };

// Where to begin, then the journeys in the order to read them, then the rest.
export function HomeMap(): ReactNode {
  const { start, guides, deeper } = homeMapSections();
  return (
    <div className={styles.map}>
      <section aria-labelledby="home-start">
        <h2 id="home-start" className={styles.heading}>
          Start here
        </h2>
        <ul className={styles.start}>
          {start.map(({ section, look }) => (
            <li key={section.id}>
              <DocsLink className={classNames(styles.card, LOOKS[look])} to={section.route}>
                <span className={styles.label}>{section.label}</span>
                <span className={styles.summary}>{section.summary}</span>
              </DocsLink>
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="home-journeys">
        <h2 id="home-journeys" className={styles.heading}>
          Follow a journey
        </h2>
        <p className={styles.lede}>
          Four short guides, in order. Each one shows real requests and links to the full recording.{' '}
          <DocsLink to={guides.route}>All guides</DocsLink>
        </p>
        <ol className={styles.journeys}>
          {JOURNEYS.map((journey) => (
            <li key={journey.route}>
              <DocsLink className={styles.card} to={journey.route}>
                <span className={styles.label}>{journey.label}</span>
                <span className={styles.summary}>{journey.summary}</span>
              </DocsLink>
            </li>
          ))}
        </ol>
      </section>
      <section aria-labelledby="home-deeper">
        <h2 id="home-deeper" className={styles.heading}>
          Understand it, run it, look it up
        </h2>
        <ul className={styles.deeper}>
          {deeper.map((section) => (
            <li key={section.id}>
              <DocsLink className={styles.row} to={section.route}>
                <span className={styles.label}>{section.label}</span>
                <span className={styles.summary}>{section.summary}</span>
              </DocsLink>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
