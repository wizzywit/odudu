import type { ReactElement } from 'react';

export function Branches({ on, text }: { on: boolean; text?: string }): ReactElement {
  const name = on ? 'a' : 'b';
  const shown = text ?? 'none';
  const other = text || 'other';
  if (on) return <p>{name}</p>;
  switch (name) {
    case 'a':
      return <p>{shown}</p>;
    default:
      return <p>{other}</p>;
  }
}
