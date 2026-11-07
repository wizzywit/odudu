import { DocsLink } from '@site/src/shared/ui/DocsLink/DocsLink';
import type { ReactElement } from 'react';
import { Section } from '@site/src/features/landing/ui/Section/Section';
import styles from '@site/src/features/landing/ui/Compare/Compare.module.css';

export function Compare(): ReactElement {
  return (
    <Section
      id="home-compare"
      kicker="How it compares"
      title="Honest about where it stands"
      section="compare"
      tone="sunken"
    >
      <p className={styles.sectionLede} data-reveal="">
        You may be choosing between Odudu and another identity provider you run yourself. The
        comparison page lists what Odudu does today, each with a page that shows it working, and
        what it does not do. It says nothing about other products, because facts about them go
        stale.
      </p>
      <p className={styles.callout} data-reveal="">
        <strong>Odudu is before 1.0.</strong> It has not had an independent security review yet and
        it runs as one instance. The roadmap lists what is built, what comes next and what is
        decided against.
      </p>
      <p className={styles.links} data-reveal="">
        <DocsLink className={styles.inline} to="/introduction/compare/">
          How Odudu compares
        </DocsLink>
        <DocsLink className={styles.inline} to="/guides/keycloak/">
          Coming from Keycloak
        </DocsLink>
        <DocsLink className={styles.inline} to="/roadmap/">
          The roadmap
        </DocsLink>
      </p>
    </Section>
  );
}
