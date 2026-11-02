import Head from '@docusaurus/Head';
import type { ReactElement } from 'react';
import { CAPABILITIES } from '@site/src/features/landing/services/content';
import { useLandingPage } from '@site/src/features/landing/use-cases/useLandingPage';
import { Agents } from '@site/src/features/landing/ui/Agents/Agents';
import { Branding } from '@site/src/features/landing/ui/Branding/Branding';
import { Browse } from '@site/src/features/landing/ui/Browse/Browse';
import { CardList } from '@site/src/features/landing/ui/CardList/CardList';
import { Compare } from '@site/src/features/landing/ui/Compare/Compare';
import { Hero } from '@site/src/features/landing/ui/Hero/Hero';
import { FONT_PRELOADS } from '@site/src/features/landing/ui/LandingPage/preloads';
import { Pages } from '@site/src/features/landing/ui/Pages/Pages';
import { Section } from '@site/src/features/landing/ui/Section/Section';
import { SignInFlow } from '@site/src/features/landing/ui/SignInFlow/SignInFlow';
import { Steps } from '@site/src/features/landing/ui/Steps/Steps';
import { Ways } from '@site/src/features/landing/ui/Ways/Ways';
import { Where } from '@site/src/features/landing/ui/Where/Where';
import styles from '@site/src/features/landing/ui/LandingPage/LandingPage.module.css';

// The home page's content, under the site's own header and footer.
export function LandingPage(): ReactElement {
  const { mark, jsonLd } = useLandingPage();
  return (
    <>
      <Head>
        {FONT_PRELOADS.map((href) => (
          <link
            key={href}
            rel="preload"
            as="font"
            type="font/woff2"
            href={href}
            crossOrigin="anonymous"
          />
        ))}
        <script type="application/ld+json">{jsonLd}</script>
      </Head>
      <main className={styles.page} data-page="landing" data-motion={mark}>
        <Hero />
        <Section
          id="home-flow"
          kicker="In pictures"
          title="How sign-in works"
          section="signin"
          tone="sunken"
        >
          <p className={styles.sectionLede} data-reveal="">
            Odudu keeps sign-in in one place, so your apps never handle a password.
          </p>
          <SignInFlow />
        </Section>
        <Section
          id="home-capabilities"
          kicker="What you get"
          title="A complete sign-in service, built and shown working"
          section="capabilities"
        >
          <CardList cards={CAPABILITIES} columns={4} />
        </Section>
        <Pages />
        <Branding />
        <Steps />
        <Ways />
        <Agents />
        <Compare />
        <Where />
        <Browse />
      </main>
    </>
  );
}
