import type { ReactElement, ReactNode } from 'react';
import { Wrap } from '@site/src/features/landing/ui/Wrap/Wrap';
import styles from '@site/src/features/landing/ui/Section/Section.module.css';

interface Props {
  id: string;
  kicker: string;
  title: string;
  section?: string;
  tone?: 'plain' | 'sunken';
  aside?: ReactNode;
  children: ReactNode;
}

const BANDS = { plain: styles.band, sunken: styles.bandSunken };

// One band of the landing page: a kicker, a heading and its content, with an
// optional picture in a column of its own beside all three.
export function Section({
  id,
  kicker,
  title,
  section,
  tone = 'plain',
  aside,
  children,
}: Props): ReactElement {
  const heading = (
    <div data-reveal="heading">
      <p className={styles.kicker}>{kicker}</p>
      <h2 id={id} className={styles.heading}>
        {title}
      </h2>
    </div>
  );
  return (
    <section className={BANDS[tone]} aria-labelledby={id} data-section={section}>
      <Wrap>
        {aside ? (
          <div className={styles.split}>
            <div className={styles.main}>
              {heading}
              {children}
            </div>
            <div className={styles.aside} data-aside="" data-reveal="">
              {aside}
            </div>
          </div>
        ) : (
          <>
            {heading}
            {children}
          </>
        )}
      </Wrap>
    </section>
  );
}
