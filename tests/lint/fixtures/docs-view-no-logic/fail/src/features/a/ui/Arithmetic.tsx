import type { ReactElement } from 'react';

export function Arithmetic({ n, label }: { n: number; label: string }): ReactElement {
  const next = n + 1;
  const half = n / 2;
  return (
    <p title={label + 'x'} data-n={String(next * half)}>
      {-n}
    </p>
  );
}
