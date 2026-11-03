import {
  backToLabel,
  signedInToTitle,
  signInToLabel,
} from '#/entities/session/services/sessionStatusText';
import { tenantPage } from '#/shared/lib/services/address';

export function useSignedInElsewhereText(
  signedInTo: string,
  tenant: string,
): { title: string; backLabel: string; backHref: string; signInLabel: string } {
  return {
    title: signedInToTitle(signedInTo),
    backLabel: backToLabel(signedInTo),
    backHref: tenantPage(signedInTo),
    signInLabel: signInToLabel(tenant),
  };
}
