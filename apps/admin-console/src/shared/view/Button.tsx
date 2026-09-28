import { Button as AriaButton, type ButtonProps as AriaButtonProps } from 'react-aria-components';
import styles from '#/shared/view/Button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger';

export interface ButtonProps extends Omit<AriaButtonProps, 'className' | 'style'> {
  variant?: ButtonVariant;
  size?: 'regular' | 'small';
}

export function Button({ variant = 'secondary', size = 'regular', ...props }: ButtonProps) {
  return (
    <AriaButton
      {...props}
      className={styles.button ?? ''}
      data-variant={variant}
      data-size={size}
    />
  );
}
