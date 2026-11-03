import type { ErrorComponentProps } from '@tanstack/react-router';
import { RouteFailure } from '#/widgets/failure/ui/RouteFailure';

// For the routes that draw the shell: a failure in one has no shell to sit in.
export function ShellFailure(props: ErrorComponentProps) {
  return <RouteFailure {...props} standalone />;
}
