import { DocsLink } from '@site/src/shared/ui/DocsLink/DocsLink';
import type { ReactElement } from 'react';
import type { LandingPage } from '@site/src/features/landing/use-cases/useLandingPage';
import { Chip } from '@site/src/features/landing/ui/Chip/Chip';
import { Section } from '@site/src/features/landing/ui/Section/Section';
import styles from '@site/src/features/landing/ui/Agents/Agents.module.css';

interface Props {
  agents: LandingPage['agents'];
}

export function Agents({ agents }: Props): ReactElement {
  return (
    <Section
      id="home-agents"
      kicker="For AI agents"
      title="What is planned for AI agents"
      section="agents"
      tone="sunken"
    >
      <div className={styles.cards}>
        {agents.items.map((item) => (
          <div key={item.id} className={styles.pane} data-reveal="" data-planned={item.id}>
            <h3 className={styles.title}>
              {item.title}
              <Chip>{agents.plannedLabel}</Chip>
            </h3>
            <p className={styles.body}>{item.claim}</p>
            <p className={styles.link}>
              <DocsLink to={agents.roadmapPath}>On the roadmap</DocsLink>
            </p>
          </div>
        ))}
      </div>
    </Section>
  );
}
