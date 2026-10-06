export function Rows({ rows }: { rows: readonly string[] }) {
  const sorted = [...rows].sort();
  return <p>{sorted.join(',')}</p>;
}
