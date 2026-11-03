import { useEffect, useId, useRef, type ReactNode } from 'react';
import { CopyValue } from '#/shared/ui/CopyValue';
import styles from '#/shared/ui/FailurePanel/FailurePanel.module.css';

// The page a person was about to read is gone and this takes its place without
// their asking. Focus moves to the heading, which a screen reader reads; the
// one-sentence summary is the alert, so the buttons and the details block are
// not read out a second time on insertion.
export function FailurePanel({
  kicker,
  title: heading,
  text,
  message,
  messageLabel,
  detailsHeading,
  detailsLabel,
  details,
  actions,
  announced = true,
}: {
  kicker: string;
  title: string;
  text: string;
  // Present only where a build is allowed to say what the error said.
  message: string | null;
  messageLabel: string;
  detailsHeading: string;
  // What the copy button says it copies: "Copy" + label.
  detailsLabel: string;
  details: string;
  actions: ReactNode;
  // False for a specimen on a page that did not fail: nothing is announced and
  // focus stays where it was.
  announced?: boolean;
}) {
  const headingId = useId();
  // Two specimens on one page would be two landmarks of one name.
  const Frame = announced ? 'section' : 'div';
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (announced) titleRef.current?.focus();
  }, [announced]);
  return (
    <Frame className={styles.panel} {...(announced ? { 'aria-labelledby': headingId } : {})}>
      <p className={styles.kicker}>{kicker}</p>
      <h1 id={headingId} ref={titleRef} tabIndex={-1} className={styles.title}>
        {heading}
      </h1>
      <p className={styles.text} {...(announced ? { role: 'alert' } : {})}>
        {text}
      </p>
      {message === null ? null : (
        <p className={styles.message}>
          <span className={styles.messageLabel}>{messageLabel}</span>
          <code className={styles.messageText}>{message}</code>
        </p>
      )}
      <div className={styles.actions}>{actions}</div>
      <div className={styles.details}>
        <h2 className={styles.detailsHeading}>{detailsHeading}</h2>
        <CopyValue label={detailsLabel} value={details} block />
      </div>
    </Frame>
  );
}
