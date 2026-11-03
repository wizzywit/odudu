import type { ReactElement } from 'react';
import type { PageShotCard } from '@site/src/features/landing/services/serverPageCards';
import type { LandingPage } from '@site/src/features/landing/use-cases/useLandingPage';
import { usePageShot } from '@site/src/features/landing/use-cases/usePageShot';
import { Frame } from '@site/src/features/landing/ui/Frame/Frame';
import { classNames } from '@site/src/shared/ui/classNames';
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

function Row({ kind, shots }: { kind: PageShotCard['size']; shots: PageShotCard[] }): ReactElement {
  return (
    <div className={classNames(styles.row, ROWS[kind])} data-row={kind}>
      {shots.map((shot) => (
        <Shot key={shot.name} {...shot} />
      ))}
    </div>
  );
}

interface Props {
  pageShots: LandingPage['pageShots'];
}

export function PageShots({ pageShots }: Props): ReactElement {
  return (
    <div className={styles.strip} data-strip="">
      <Row kind="large" shots={pageShots.large} />
      <Row kind="small" shots={pageShots.small} />
    </div>
  );
}
