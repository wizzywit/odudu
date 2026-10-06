export function Rows({ rows }: { rows: readonly string[] }) {
  const sorted = useMemo(() => [...rows].sort(), [rows]);
  return <p>{sorted.join(',')}</p>;
}
