import { memo } from 'react';

export const Row = memo(function Row({ name }: { name: string }) {
  return <li>{name}</li>;
});
