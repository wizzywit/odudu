import type { ReactElement } from 'react';
import type { CheckModel } from '@site/src/features/landing/services/sceneModel';
import styles from '@site/src/features/landing/ui/SceneCheck/SceneCheck.module.css';

interface Props {
  check: CheckModel;
}

// A check mark in a filled circle.
export function SceneCheck({ check }: Props): ReactElement {
  return (
    <>
      <circle className={styles.pass} cx={check.x} cy={check.y} r={check.r} />
      <path className={styles.check} d={check.path} />
    </>
  );
}
