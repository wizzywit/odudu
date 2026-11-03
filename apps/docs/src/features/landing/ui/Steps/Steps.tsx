import { DocsLink } from '@site/src/shared/ui/DocsLink/DocsLink';
import type { ReactElement } from 'react';
import type { LandingPage } from '@site/src/features/landing/use-cases/useLandingPage';
import { Section } from '@site/src/features/landing/ui/Section/Section';
import styles from '@site/src/features/landing/ui/Steps/Steps.module.css';

interface Props {
  steps: LandingPage['steps'];
}

export function Steps({ steps }: Props): ReactElement {
  return (
    <Section
      id="home-steps"
      kicker="First run"
      title="From docker compose up to your first sign-in"
      tone="sunken"
    >
      <ol className={styles.steps}>
        {steps.map((step) => (
          <li key={step.title} className={styles.step} data-reveal="">
            <h3 className={styles.cardTitle}>{step.title}</h3>
            <p className={styles.cardBody}>{step.body}</p>
          </li>
        ))}
      </ol>
      <p className={styles.after} data-reveal="">
        <DocsLink className={styles.inline} to="/quick-start/">
          The quick start
        </DocsLink>{' '}
        has every step, with what you should see.
      </p>
    </Section>
  );
}
