import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { StrictMode, useState, type ReactNode } from 'react';
import { createQueryClient } from '#/shared/repository/queryClient.ts';
import { loadThemeChoice } from '#/shared/adapter/themeChoice.ts';
import { rememberThemeChoice } from '#/shared/repository/themeChoice.ts';
import { useDialogHost } from '#/shared/repository/useDialogHost.ts';
import { ThemeContext } from '#/shared/repository/useTheme.ts';
import { createBrowserTransport, type Transport } from '#/shared/transport/transport.ts';
import { TransportContext } from '#/shared/transport/useTransport.ts';
import type { ThemeChoice } from '#/shared/service/theme.ts';
import { DialogPresence } from '#/shared/view/dialogPresence.ts';

// What the console keeps in Context rather than a store: the transport, the
// theme, and the query client the repositories read through.
export function Providers({
  transport: given,
  queryClient: givenClient,
  children,
}: {
  readonly transport?: Transport;
  readonly queryClient?: QueryClient;
  readonly children: ReactNode;
}) {
  const [transport] = useState(() => given ?? createBrowserTransport());
  const [queryClient] = useState(() => givenClient ?? createQueryClient());
  const [choice, setChoice] = useState<ThemeChoice>(loadThemeChoice);
  const [theme] = useState(() => ({
    choose: (next: ThemeChoice) => {
      rememberThemeChoice(next);
      setChoice(next);
    },
  }));
  const opened = useDialogHost((host) => host.opened);
  return (
    <StrictMode>
      <TransportContext value={transport}>
        <QueryClientProvider client={queryClient}>
          <ThemeContext value={{ choice, choose: theme.choose }}>
            <DialogPresence value={opened}>{children}</DialogPresence>
          </ThemeContext>
        </QueryClientProvider>
      </TransportContext>
    </StrictMode>
  );
}
