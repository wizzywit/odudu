export function Rows({ rows }: { rows: readonly string[] }) {
  // measured: docs/phases/p4d.md
  const sorted = useMemo(() => [...rows].sort(), [rows]);
  return <p>{sorted.join(',')}</p>;
}
