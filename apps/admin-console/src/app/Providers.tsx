import { StrictMode, type ReactNode } from 'react';
import { useDialogHost } from '#/shared/repository/useDialogHost.ts';
import { DialogPresence } from '#/shared/view/dialogPresence.ts';

export function Providers({ children }: { readonly children: ReactNode }) {
  const opened = useDialogHost((host) => host.opened);
  return (
    <StrictMode>
      <DialogPresence value={opened}>{children}</DialogPresence>
    </StrictMode>
  );
}
