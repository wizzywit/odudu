import type { MailBrandingView } from '#/pages/branding/types/mailBranding';
import { readMailBranding } from '#/pages/branding/adapter/mail';
import { mailBrandingKey } from '#/pages/branding/repository/queryKeys';
import { useRead } from '#/shared/lib/repository/useRead';
import type { Read } from '#/shared/lib/services/read';
import { useTransport } from '#/shared/api/transport/useTransport';

export function useMailBranding(
  tenant: string,
  publishedVersion: number | undefined,
  client: string,
  asked: boolean,
): Read<MailBrandingView> {
  const { gateway } = useTransport();
  return useRead(mailBrandingKey(tenant, publishedVersion ?? 0, client), asked, () =>
    readMailBranding(gateway, tenant, client),
  );
}
