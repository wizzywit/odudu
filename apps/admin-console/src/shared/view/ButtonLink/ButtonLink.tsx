import type { ReactNode } from 'react';
import { Link } from 'react-aria-components';
import { buttonClass, type ButtonVariant } from '#/shared/view/Button';
import styles from '#/shared/view/ButtonLink/ButtonLink.module.css';

// A link that goes somewhere, drawn as a button: a real href, so it opens
// in a new tab too, while an ordinary click navigates through the router.
export function ButtonLink({
  href,
  variant = 'secondary',
  size = 'regular',
  children,
}: {
  href: string;
  variant?: ButtonVariant;
  size?: 'regular' | 'small';
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`${buttonClass} ${styles.link ?? ''}`}
      data-variant={variant}
      data-size={size}
    >
      {children}
    </Link>
  );
}
