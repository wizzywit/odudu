import Link from '@docusaurus/Link';
import type { ReactElement } from 'react';
import { useNotFound } from '@site/src/features/not-found/use-cases/useNotFound';
import { LostArt } from '@site/src/features/not-found/ui/LostArt/LostArt';
import { classNames } from '@site/src/shared/ui/classNames';
import { DocsLink } from '@site/src/shared/ui/DocsLink/DocsLink';
import styles from '@site/src/features/not-found/ui/NotFoundPage/NotFoundPage.module.css';

// What the theme's not-found route shows, in place of its default.
export function NotFoundPage(): ReactElement {
  const { title, message, routes, searchLabel } = useNotFound();
  return (
    <main className={classNames('container margin-vert--xl', styles.page)} data-page="not-found">
      <LostArt />
      <h1 className={styles.title}>{title}</h1>
      <p className={styles.message}>{message}</p>
      <ul className={styles.links}>
        {routes.map((entry) => (
          <li key={entry.id}>
            <DocsLink to={entry.route}>{entry.label}</DocsLink>
          </li>
        ))}
        <li>
          <Link to="/search/">{searchLabel}</Link>
        </li>
      </ul>
    </main>
  );
}
