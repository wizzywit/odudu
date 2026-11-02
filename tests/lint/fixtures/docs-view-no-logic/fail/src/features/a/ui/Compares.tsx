import type { ReactElement } from 'react';

export function Compares({ tone, index }: { tone: string; index: number }): ReactElement {
  return (
    <p className={tone === 'x' ? 'a' : 'b'} data-first={index > 0}>
      {index !== 1 ? <b /> : null}
    </p>
  );
}
