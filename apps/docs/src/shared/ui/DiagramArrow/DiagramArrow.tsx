import type { ReactElement } from 'react';
import { INK } from '@site/src/shared/services/diagram';

interface Props {
  d: string;
  head: string;
  dashed?: boolean;
}

export function DiagramArrow({ d, head, dashed = false }: Props): ReactElement {
  return (
    <path
      d={d}
      fill="none"
      stroke={INK.muted}
      strokeWidth={1.8}
      strokeDasharray={dashed ? '5 4' : undefined}
      markerEnd={`url(#${head})`}
    />
  );
}
