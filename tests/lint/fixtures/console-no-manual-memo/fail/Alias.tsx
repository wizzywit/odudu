import { useMemo as keep } from 'react';

export function Rows({ rows }: { rows: readonly string[] }) {
  const sorted = keep(() => [...rows].sort(), [rows]);
  return <p>{sorted.join(',')}</p>;
}
