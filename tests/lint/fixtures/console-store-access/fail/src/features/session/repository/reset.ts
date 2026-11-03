import { useToasts } from '#/shared/lib/repository/useToasts';

export function clearToasts(): void {
  useToasts.setState({ toasts: [] });
}
