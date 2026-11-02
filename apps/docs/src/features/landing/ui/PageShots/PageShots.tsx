import type { ReactElement } from 'react';
import { type PageShotCard } from '@site/src/features/landing/services/content';
import { shotsOfSize } from '@site/src/features/landing/services/pageShot';
import { usePageShot } from '@site/src/features/landing/use-cases/usePageShot';
import { Frame } from '@site/src/features/landing/ui/Frame/Frame';
import styles from '@site/src/features/landing/ui/PageShots/PageShots.module.css';

function Shot({ name, caption, alt, size: kind, note }: PageShotCard): ReactElement {
  const { light, dark, size } = usePageShot(name);
  return (
    <figure className={styles.shot} data-reveal="">
      <Frame kind={kind}>
        <img
          className={styles.light}
          src={light}
          alt={alt}
          width={size.width}
          height={size.height}
          loading="lazy"
        />
        <img
          className={styles.dark}
          src={dark}
          alt={alt}
          width={size.width}
          height={size.height}
          loading="lazy"
        />
      </Frame>
      <figcaption className={styles.caption}>
        <strong className={styles.name} data-caption="">
          {caption}
        </strong>
        {note ? (
          <span className={styles.note} data-note="">
            {note}
          </span>
        ) : null}
      </figcaption>
    </figure>
  );
}

const ROWS = { large: styles.large, small: styles.small };

function Row({ kind }: { kind: PageShotCard['size'] }): ReactElement {
  return (
    <div className={[styles.row, ROWS[kind]].join(' ')} data-row={kind}>
      {shotsOfSize(kind).map((shot) => (
        <Shot key={shot.name} {...shot} />
      ))}
    </div>
  );
}

export function PageShots(): ReactElement {
  return (
    <div className={styles.strip} data-strip="">
      <Row kind="large" />
      <Row kind="small" />
    </div>
  );
}
