import type { ReactElement, ReactNode } from 'react';
import { classNames } from '@site/src/shared/ui/classNames';
import styles from '@site/src/features/landing/ui/Wrap/Wrap.module.css';

interface Props {
  className?: string;
  children: ReactNode;
}

// The page's column: the widest a band's content goes, with a gutter at each side.
export function Wrap({ className, children }: Props): ReactElement {
  return <div className={classNames(styles.wrap, className)}>{children}</div>;
}
