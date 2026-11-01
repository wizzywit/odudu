import { Menu, MenuItem, MenuTrigger, Popover, Text } from 'react-aria-components';
import { Button } from '#/shared/view/Button';
import styles from '#/shared/view/ActionMenu/ActionMenu.module.css';

export interface MenuAction {
  id: string;
  label: string;
  // Under the label, as why an action is held.
  description?: string;
  isDisabled?: boolean;
  tone?: 'danger';
  onAction: () => void;
}

// A button that opens a short list of actions. Arrow keys move through them,
// Escape closes it, and focus returns to the button.
export function ActionMenu({
  label,
  trigger,
  actions,
}: {
  // Names the button and the list; `trigger` is what the button shows.
  label: string;
  trigger: string;
  actions: readonly MenuAction[];
}) {
  return (
    <MenuTrigger>
      <Button aria-label={label}>{trigger}</Button>
      <Popover className={styles.popover ?? ''} placement="bottom end">
        <Menu className={styles.menu ?? ''} aria-label={label}>
          {actions.map((action) => (
            <MenuItem
              key={action.id}
              id={action.id}
              className={styles.item ?? ''}
              data-tone={action.tone}
              isDisabled={action.isDisabled ?? false}
              onAction={action.onAction}
            >
              <Text slot="label">{action.label}</Text>
              {action.description === undefined ? null : (
                <Text slot="description" className={styles.description ?? ''}>
                  {action.description}
                </Text>
              )}
            </MenuItem>
          ))}
        </Menu>
      </Popover>
    </MenuTrigger>
  );
}
