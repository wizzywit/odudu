import type { ReactElement, ReactNode } from 'react';
import { classNames } from '@site/src/shared/ui/classNames';
import styles from '@site/src/features/landing/ui/Frame/Frame.module.css';

type Kind = 'large' | 'small' | 'look';

const KINDS = { large: styles.large, small: styles.small, look: styles.look };

interface Props {
  kind: Kind;
  children: ReactNode;
}

// A picture of a server page in a box of one fixed shape per kind, so a row of them
// never changes height: a taller page is cropped at the bottom, a shorter one centred.
export function Frame({ kind, children }: Props): ReactElement {
  return (
    <div className={classNames(styles.frame, KINDS[kind])} data-frame={kind}>
      {children}
    </div>
  );
}
