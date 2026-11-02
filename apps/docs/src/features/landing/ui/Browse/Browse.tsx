import { DocsLink } from '@site/src/shared/ui/DocsLink/DocsLink';
import type { ReactElement } from 'react';
import { JOURNEYS, SECTIONS } from '@site/nav';
import { MARKDOWN_LINE } from '@site/src/features/landing/services/content';
import { useAssetUrls } from '@site/src/features/landing/use-cases/useAssetUrls';
import { Section } from '@site/src/features/landing/ui/Section/Section';
import styles from '@site/src/features/landing/ui/Browse/Browse.module.css';

export function Browse(): ReactElement {
  const { llms } = useAssetUrls();
  return (
    <Section
      id="home-browse"
      kicker="The documentation"
      title="Everything else is a click away"
      section="browse"
      tone="sunken"
    >
      <div className={styles.pair}>
        <ul className={styles.rows}>
          {SECTIONS.map((section) => (
            <li key={section.id} data-reveal="">
              <DocsLink className={styles.row} to={section.route}>
                <span className={styles.rowLabel}>{section.label}</span>
                <span className={styles.rowSummary}>{section.summary}</span>
              </DocsLink>
            </li>
          ))}
          <li data-reveal="">
            <DocsLink className={styles.row} to="/" data-docs-home="">
              <span className={styles.rowLabel}>Documentation home</span>
              <span className={styles.rowSummary}>
                Every section and the four journeys on one page.
              </span>
            </DocsLink>
          </li>
        </ul>
        <div className={styles.stack}>
          <div data-reveal="" className={styles.pane}>
            <h3 className={styles.cardTitle}>Four journeys, in order</h3>
            <p className={styles.cardBody}>
              Each follows one path with real requests, and links to the full recording.
            </p>
            <ol className={styles.journeys}>
              {JOURNEYS.map((journey) => (
                <li key={journey.route}>
                  <DocsLink className={styles.inline} to={journey.route}>
                    {journey.label}
                  </DocsLink>
                </li>
              ))}
            </ol>
          </div>
          <p className={styles.cardBody} data-markdown="" data-reveal="">
            {MARKDOWN_LINE.before}
            <a href={llms}>{MARKDOWN_LINE.link}</a>
            {MARKDOWN_LINE.after}
          </p>
        </div>
      </div>
    </Section>
  );
}
