import type { ReactElement } from 'react';

export function Drawing({ width }: { width: number }): ReactElement {
  return <rect width={width * 2 + 4} height={width > 3 ? 10 : 20} />;
}
