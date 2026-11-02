import { DocsLink } from '@site/src/shared/ui/DocsLink/DocsLink';
import type { ReactElement } from 'react';
import {
  AGENT_ITEMS,
  PLANNED_LABEL,
  ROADMAP_NEXT,
} from '@site/src/features/landing/services/content';
import { Chip } from '@site/src/features/landing/ui/Chip/Chip';
import { Section } from '@site/src/features/landing/ui/Section/Section';
import styles from '@site/src/features/landing/ui/Agents/Agents.module.css';

export function Agents(): ReactElement {
  return (
    <Section
      id="home-agents"
      kicker="For AI agents"
      title="What is planned for AI agents"
      section="agents"
      tone="sunken"
    >
      <div className={styles.cards}>
        {AGENT_ITEMS.map((item) => (
          <div key={item.id} className={styles.pane} data-reveal="" data-planned={item.id}>
            <h3 className={styles.title}>
              {item.title}
              <Chip>{PLANNED_LABEL}</Chip>
            </h3>
            <p className={styles.body}>{item.claim}</p>
            <p className={styles.link}>
              <DocsLink to={ROADMAP_NEXT}>On the roadmap</DocsLink>
            </p>
          </div>
        ))}
      </div>
    </Section>
  );
}
