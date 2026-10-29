import type { MailBrandingView } from '@odudu/contracts/admin';
import { readMailBranding } from '#/features/branding/adapter/mail';
import { mailBrandingKey } from '#/shared/repository/queryKeys';
import { useRead } from '#/shared/repository/useRead';
import type { Read } from '#/shared/service/read';
import { useTransport } from '#/shared/transport/useTransport';

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
