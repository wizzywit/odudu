import type { ReactElement } from 'react';

export function Gate({ on, text }: { on: boolean; text: string }): ReactElement {
  const label = on && text;
  return <p>{label}</p>;
}
