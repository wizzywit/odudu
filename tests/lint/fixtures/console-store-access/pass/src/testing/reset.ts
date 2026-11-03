import { useToasts } from '#/shared/lib/repository/useToasts';

export function reset(): void {
  useToasts.setState(useToasts.getInitialState(), true);
  useToasts.getState().push('x');
}
