export function Card({ title, items }: { title: string; items: readonly string[] }) {
  return <p>{title + String(items.length)}</p>;
}
