import type { ReactElement } from 'react';
import { SURFACE, type Tone } from '@site/src/shared/services/diagram';

interface Props {
  x: number;
  y: number;
  w: number;
  h: number;
  tone?: Tone;
}

export function DiagramBox({ x, y, w, h, tone = 'panel' }: Props): ReactElement {
  return (
    <rect
      x={x}
      y={y}
      width={w}
      height={h}
      rx={8}
      fill={SURFACE[tone].fill}
      stroke={SURFACE[tone].stroke}
      strokeWidth={1.5}
      data-surface={tone}
    />
  );
}
