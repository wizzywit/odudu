import { DocsLink } from '@site/src/shared/ui/DocsLink/DocsLink';
import type { ReactElement } from 'react';
import type { LandingPage } from '@site/src/features/landing/use-cases/useLandingPage';
import { PageShots } from '@site/src/features/landing/ui/PageShots/PageShots';
import { Section } from '@site/src/features/landing/ui/Section/Section';
import styles from '@site/src/features/landing/ui/Pages/Pages.module.css';

interface Props {
  pageShots: LandingPage['pageShots'];
}

export function Pages({ pageShots }: Props): ReactElement {
  return (
    <Section
      id="home-pages"
      kicker="What it looks like"
      title="The pages your users see"
      section="pages"
    >
      <p className={styles.lede} data-reveal="">
        Odudu shows these pages itself, so your app builds none of them.{' '}
        <DocsLink to="/guides/sign-a-user-in/">See a sign-in end to end</DocsLink>
      </p>
      <PageShots pageShots={pageShots} />
    </Section>
  );
}
