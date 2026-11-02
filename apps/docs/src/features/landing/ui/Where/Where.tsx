import { DocsLink } from '@site/src/shared/ui/DocsLink/DocsLink';
import type { ReactElement } from 'react';
import { REPOSITORY_URL } from '@site/nav';
import { LICENSING_URL_PATH } from '@site/src/features/landing/services/content';
import { useAssetUrls } from '@site/src/features/landing/use-cases/useAssetUrls';
import { Chip } from '@site/src/features/landing/ui/Chip/Chip';
import { Section } from '@site/src/features/landing/ui/Section/Section';
import styles from '@site/src/features/landing/ui/Where/Where.module.css';

export function Where(): ReactElement {
  const { sansLicence, monoLicence } = useAssetUrls();
  return (
    <Section id="home-where" kicker="Where it runs" title="Self-hosted today, hosted in the works">
      <div className={styles.pair}>
        <div data-reveal="" className={styles.pane}>
          <h3 className={styles.cardTitle}>Run it yourself</h3>
          <p className={styles.cardBody}>
            This is what exists. Odudu is one container beside Postgres, and the quick start has it
            running on your machine with the console open.{' '}
            <DocsLink to="/operating/">Operating Odudu</DocsLink> covers a server other people can
            reach.
          </p>
        </div>
        <div data-reveal="" className={styles.pane} data-section="hosted">
          <h3 className={styles.cardTitle}>
            Hosted Odudu <Chip>In the works</Chip>
          </h3>
          <p className={styles.cardBody}>
            A hosted Odudu, run for you, is in the works. It has no date. Nothing in the open source
            server waits for it. <DocsLink to="/roadmap/">Read the roadmap</DocsLink>
          </p>
        </div>
      </div>
      <p className={styles.after} data-reveal="" data-section="licence">
        Free software: the server, the console and the command-line tool are AGPL-3.0, and the
        documentation text and the examples are Apache-2.0. An app that only talks to Odudu over
        OpenID Connect or the admin API is not a derivative work of it.{' '}
        <a href={`${REPOSITORY_URL}${LICENSING_URL_PATH}`}>How the licences fit together</a>. The
        fonts are IBM Plex Sans and Mono under the SIL Open Font License 1.1 (
        <a href={sansLicence}>Sans</a>, <a href={monoLicence}>Mono</a>)
      </p>
    </Section>
  );
}
