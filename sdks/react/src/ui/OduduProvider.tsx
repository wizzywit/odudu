import type { ReactNode } from 'react';
import { AuthProvider } from '#/use-cases/auth-context';
import { useAuthController } from '#/use-cases/auth-controller';
import type { Mode } from '#/types';

// `mode` is read once, when the provider mounts.
export function OduduProvider({ mode, children }: { mode: Mode; children: ReactNode }) {
  return <AuthProvider value={useAuthController(mode)}>{children}</AuthProvider>;
}
