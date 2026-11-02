import type { ReactElement } from 'react';
import { INK, WIDTH } from '@site/src/shared/services/diagram';

export function DiagramWall({ y }: { y: number }): ReactElement {
  return (
    <line
      x1={10}
      x2={WIDTH - 10}
      y1={y}
      y2={y}
      stroke={INK.muted}
      strokeWidth={2}
      strokeDasharray="6 5"
    />
  );
}
