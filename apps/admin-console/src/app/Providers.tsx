import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { StrictMode, useState, type ReactNode } from 'react';
import { I18nProvider } from 'react-aria-components';
import { createReadCache } from '#/shared/repository/readCache';
import { loadThemeChoice } from '#/shared/adapter/themeChoice';
import { rememberThemeChoice } from '#/shared/repository/themeChoice';
import { useDialogHost } from '#/shared/repository/useDialogHost';
import { ThemeContext } from '#/shared/repository/useTheme';
import { createBrowserTransport, type Transport } from '#/shared/transport/transport';
import { TransportContext } from '#/shared/transport/useTransport';
import type { ThemeChoice } from '#/shared/services/theme';
import { DialogPresence } from '#/shared/ui/dialogPresence';

// What the console keeps in Context rather than a store: the transport, the
// theme, and the query client the repositories read through. Dates, names
// and lists follow the browser's own locale, which I18nProvider reads.
export function Providers({
  transport: given,
  queryClient: givenClient,
  children,
}: {
  transport?: Transport;
  queryClient?: QueryClient;
  children: ReactNode;
}) {
  const [transport] = useState(() => given ?? createBrowserTransport());
  const [queryClient] = useState(() => givenClient ?? createReadCache());
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
            <I18nProvider>
              <DialogPresence value={opened}>{children}</DialogPresence>
            </I18nProvider>
          </ThemeContext>
        </QueryClientProvider>
      </TransportContext>
    </StrictMode>
  );
}
