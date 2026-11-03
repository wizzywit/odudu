import type { ReactElement } from 'react';
import { loadingFor } from '@site/src/shared/lib/services/pictureShot';
import { useConsoleShot } from '@site/src/shared/lib/use-cases/useShot';
import styles from '@site/src/shared/ui/ConsoleShot/ConsoleShot.module.css';

interface Props {
  name: string;
  alt: string;
  caption: string;
  // The picture the page is waiting for: fetched first, never lazily.
  priority?: boolean;
}

// One capture per colour scheme; the one that matches the page's theme shows.
export function ConsoleShot({ name, alt, caption, priority = false }: Props): ReactElement {
  const { light, dark, size } = useConsoleShot(name);
  const { fetchPriority, loading } = loadingFor(priority);
  return (
    <figure className={styles.shot}>
      <img
        className={styles.light}
        src={light}
        alt={alt}
        width={size.width}
        height={size.height}
        fetchPriority={fetchPriority}
        loading={loading}
      />
      <img
        className={styles.dark}
        src={dark}
        alt={alt}
        width={size.width}
        height={size.height}
        loading="lazy"
      />
      <figcaption>{caption}</figcaption>
    </figure>
  );
}
