export function Rows({ rows }: { rows: readonly string[] }) {
  // measured: docs/measurements/nobody-wrote-this.md
  const sorted = useMemo(() => [...rows].sort(), [rows]);
  return <p>{sorted.join(',')}</p>;
}
