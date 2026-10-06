import { ListBox, ListBoxItem } from 'react-aria-components';

const LABEL = 'Options';

export function Options({ options }: { options: readonly { id: string; label: string }[] }) {
  return (
    <ListBox aria-label={LABEL} items={options}>
      {(option) => <ListBoxItem id={option.id}>{String(option.label)}</ListBoxItem>}
    </ListBox>
  );
}
