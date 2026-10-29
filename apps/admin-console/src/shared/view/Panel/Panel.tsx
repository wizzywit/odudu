import { useId, type ReactNode, type Ref } from 'react';
import styles from '#/shared/view/Panel/Panel.module.css';

// A bordered region of a record page, named by its own heading. A heading
// given a ref can take focus, for the page to hand it back after a removal.
export function Panel({
  title,
  headingRef,
  headingClassName,
  children,
}: {
  title: ReactNode;
  headingRef?: Ref<HTMLHeadingElement>;
  // For a page that sets its own heading apart, as one that shows it only
  // where there is room.
  headingClassName?: string;
  children: ReactNode;
}) {
  const heading = useId();
  return (
    <section aria-labelledby={heading} className={styles.panel}>
      <h2
        id={heading}
        ref={headingRef}
        tabIndex={headingRef === undefined ? undefined : -1}
        className={
          headingClassName === undefined ? styles.heading : `${styles.heading ?? ''} ${headingClassName}`
        }
      >
        {title}
      </h2>
      {children}
    </section>
  );
}
