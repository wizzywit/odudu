import { amendTenantSettings } from '#/entities/tenant';
import type { SaveInput } from '#/shared/repository/useSectionSave';
import type { Gateway } from '#/shared/transport/gateway';
import {
  languagesRequest,
  type LanguageValues,
} from '#/pages/branding/services/supportedLanguages';

// The languages are two of the tenant's settings, saved on the one ETag that
// stands for every setting.
export function languagesSave(tenant: string) {
  return (gateway: Gateway, { changes, ifMatch }: SaveInput<LanguageValues>) =>
    amendTenantSettings(gateway, tenant, languagesRequest(changes), ifMatch);
}
