import { DocsLink } from '@site/src/shared/ui/DocsLink/DocsLink';
import type { ReactElement } from 'react';
import { ConsoleShot } from '@site/src/shared/ui/ConsoleShot';
import { Install } from '@site/src/features/landing/ui/Install/Install';
import { Wrap } from '@site/src/features/landing/ui/Wrap/Wrap';
import styles from '@site/src/features/landing/ui/Hero/Hero.module.css';

export function Hero(): ReactElement {
  return (
    <header className={styles.hero}>
      <Wrap className={styles.heroGrid}>
        <div className={styles.heroText}>
          <span className={styles.lockup} role="img" aria-label="Odudu" />
          <h1 className={styles.title}>An identity provider you run yourself</h1>
          <p className={styles.lede}>
            Odudu is an OpenID Connect and OAuth 2.0 server with an admin console, a command-line
            tool and documentation checked against the running server. It is one container and
            Postgres, and it is open source.
          </p>
          <Install />
          <p className={styles.actions}>
            <DocsLink className={styles.primary} to="/introduction/">
              Read the docs
            </DocsLink>
            <DocsLink className={styles.secondary} to="/quick-start/">
              Follow the quick start
            </DocsLink>
          </p>
          <p className={styles.early}>
            The first stable release, before 1.0: try it and tell us what breaks.{' '}
            <DocsLink to="/roadmap/">What is built and what is next</DocsLink>
          </p>
        </div>
        <div className={styles.heroShot}>
          <ConsoleShot
            name="overview"
            priority
            alt="The Odudu admin console on a tenant's overview page: a menu of areas on the left, and counts of subjects, clients, groups, roles and scopes."
            caption="The admin console, on a tenant's overview."
          />
        </div>
      </Wrap>
    </header>
  );
}
