import { DocsLink } from '@site/src/shared/ui/DocsLink/DocsLink';
import type { ReactElement } from 'react';
import { REPOSITORY_URL } from '@site/nav';
import type { LandingPage } from '@site/src/features/landing/use-cases/useLandingPage';
import { CardList } from '@site/src/features/landing/ui/CardList/CardList';
import { Section } from '@site/src/features/landing/ui/Section/Section';
import styles from '@site/src/features/landing/ui/Ways/Ways.module.css';

interface Props {
  readers: LandingPage['readers'];
  examples: LandingPage['examples'];
}

export function Ways({ readers, examples }: Props): ReactElement {
  return (
    <Section id="home-readers" kicker="Start where you are" title="Four ways in" section="readers">
      <CardList cards={readers} columns={4} />
      <div className={styles.examples} data-section="examples" data-reveal="">
        <h3 className={styles.cardTitle}>Four small apps that work</h3>
        <ul className={styles.exampleList}>
          {examples.cards.map((example) => (
            <li key={example.to}>
              <DocsLink to={example.to}>{example.title}</DocsLink>
            </li>
          ))}
        </ul>
        <p className={styles.cardBody}>
          Each has a guide that walks through it. The source is in the{' '}
          <a
            href={`${REPOSITORY_URL}${examples.sourcePath}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            examples folder<span className="visually-hidden"> (opens in a new tab)</span>
          </a>
          .
        </p>
        <p className={styles.guideLine} data-example="wordpress">
          {examples.wordpress.lead}
          <DocsLink to={examples.wordpress.to}>{examples.wordpress.link}</DocsLink>
          {examples.wordpress.end}
        </p>
      </div>
    </Section>
  );
}
