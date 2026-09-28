interface RowItem {
  readonly id: string;
  readonly label: string;
}

interface NamedArrayPropsProps {
  readonly rows: readonly RowItem[];
  label: string;
}

export function NamedArrayProps({ rows, label }: NamedArrayPropsProps) {
  return (
    <ul aria-label={label}>
      {rows.map((row) => (
        <li key={row.id}>{row.label}</li>
      ))}
    </ul>
  );
}
