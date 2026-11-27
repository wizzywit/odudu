import { useToasts } from '#/shared/lib/repository/useToasts';

// The messages the console's toast queue holds, which the shell would draw.
export function toastsShown(): string[] {
  return useToasts.getState().toasts.map((entry) => entry.message);
}
