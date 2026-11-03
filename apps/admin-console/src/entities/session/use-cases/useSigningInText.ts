import { signingInText, signingInTitle } from '#/entities/session/services/sessionStatusText';

export function useSigningInText(
  tenant: string | null,
  ended: boolean,
): { title: string; text: string } {
  return { title: signingInTitle(ended), text: signingInText(tenant) };
}
