import { ListBox, ListBoxItem } from 'react-aria-components';

export function Options({
  options,
  taken,
}: {
  options: readonly { id: string; label: string }[];
  taken: ReadonlySet<string>;
}) {
  return (
    <ListBox aria-label="Options" items={options}>
      {(option) => (
        <ListBoxItem id={option.id}>{taken.has(option.id) ? 'taken' : option.label}</ListBoxItem>
      )}
    </ListBox>
  );
}
