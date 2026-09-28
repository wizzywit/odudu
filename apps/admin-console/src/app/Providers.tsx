import { StrictMode, type ReactNode } from 'react';

export function Providers({ children }: { readonly children: ReactNode }) {
  return <StrictMode>{children}</StrictMode>;
}
