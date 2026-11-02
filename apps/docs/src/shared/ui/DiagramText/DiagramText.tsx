import type { ReactElement, ReactNode } from 'react';
import { INK, type Ink } from '@site/src/shared/services/diagram';

interface Props {
  x: number;
  y: number;
  children: ReactNode;
  ink?: Ink;
  size?: 13 | 14 | 15;
  bold?: boolean;
  mono?: boolean;
  anchor?: 'start' | 'middle' | 'end';
}

export function DiagramText({
  x,
  y,
  children,
  ink = 'ink',
  size = 13,
  bold = false,
  mono = false,
  anchor = 'middle',
}: Props): ReactElement {
  return (
    <text
      x={x}
      y={y}
      fill={INK[ink]}
      fontSize={size}
      fontWeight={bold ? 600 : 400}
      fontFamily={mono ? 'var(--font-mono)' : undefined}
      textAnchor={anchor}
    >
      {children}
    </text>
  );
}
