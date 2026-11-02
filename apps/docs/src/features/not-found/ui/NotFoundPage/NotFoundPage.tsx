import Link from '@docusaurus/Link';
import type { ReactElement } from 'react';
import {
  NOT_FOUND_MESSAGE,
  NOT_FOUND_ROUTES,
  NOT_FOUND_TITLE,
  SEARCH_LABEL,
} from '@site/src/features/not-found/services/notFound';
import { LostArt } from '@site/src/features/not-found/ui/LostArt/LostArt';
import { classNames } from '@site/src/shared/services/classNames';
import { DocsLink } from '@site/src/shared/ui/DocsLink/DocsLink';
import styles from '@site/src/features/not-found/ui/NotFoundPage/NotFoundPage.module.css';

// What the theme's not-found route shows, in place of its default.
export function NotFoundPage(): ReactElement {
  return (
    <main className={classNames('container margin-vert--xl', styles.page)} data-page="not-found">
      <LostArt />
      <h1 className={styles.title}>{NOT_FOUND_TITLE}</h1>
      <p className={styles.message}>{NOT_FOUND_MESSAGE}</p>
      <ul className={styles.links}>
        {NOT_FOUND_ROUTES.map((entry) => (
          <li key={entry.id}>
            <DocsLink to={entry.route}>{entry.label}</DocsLink>
          </li>
        ))}
        <li>
          <Link to="/search/">{SEARCH_LABEL}</Link>
        </li>
      </ul>
    </main>
  );
}
