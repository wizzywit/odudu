export function ArrayProp({
  items,
  more,
}: {
  readonly items: readonly string[];
  readonly more: ReadonlyArray<string>;
}) {
  return (
    <ul>
      {items.concat(more).map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}
