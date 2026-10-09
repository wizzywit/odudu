import { Button as AriaButton, type ButtonProps as AriaButtonProps } from 'react-aria-components';
import styles from '#/shared/view/Button/Button.module.css';

// For a link drawn as a button, which takes the same look from the same class.
export const buttonClass = styles.button ?? '';

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger';

export interface ButtonProps extends Omit<AriaButtonProps, 'className' | 'style'> {
  variant?: ButtonVariant;
  size?: 'regular' | 'small';
}

export function Button({ variant = 'secondary', size = 'regular', ...props }: ButtonProps) {
  return <AriaButton {...props} className={buttonClass} data-variant={variant} data-size={size} />;
}
