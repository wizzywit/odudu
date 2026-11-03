import { useToasts } from '#/shared/lib/repository/useToasts';

export function Probe() {
  useToasts.setState({ toasts: [] });
  const queue = useToasts();
  useToasts.getState().push('x');
  return queue;
}
