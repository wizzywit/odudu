const cache = { memo: (key: string) => key };

export function Label({ name }: { name: string }) {
  return <p>{cache.memo(name)}</p>;
}
