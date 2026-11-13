import { createHash } from 'node:crypto';
import { TOTP_ALGORITHMS } from '@odudu/domain-identity';
import { z } from 'zod';
import { type AuthenticationSessionRecord } from '#/schema/authentication-sessions';

const offerSchema = z.strictObject({
  secretDigest: z.string().min(1),
  algorithm: z.enum(TOTP_ALGORITHMS),
  digits: z.number().int(),
  period: z.number().int(),
});

export type TotpOffer = z.infer<typeof offerSchema>;
export type TotpOfferedParameters = Omit<TotpOffer, 'secretDigest'>;

// What a sign-in remembers of the enrolment page it showed: the parameters,
// against a digest of the secret so the secret itself is not parked.
export function totpOfferOf(secret: string, parameters: TotpOfferedParameters): TotpOffer {
  return { secretDigest: createHash('sha256').update(secret).digest('hex'), ...parameters };
}

// The parameters the page offered for this secret, or null for a secret it
// did not offer: the caller then judges the code by the policy now in force,
// never by anything the browser posted.
export function offeredTotp(
  record: AuthenticationSessionRecord | null,
  secret: string,
): TotpOfferedParameters | null {
  const parsed = offerSchema.safeParse(record?.pendingRequest.totpOffer);
  if (!parsed.success) return null;
  const { secretDigest, ...parameters } = parsed.data;
  return secretDigest === totpOfferOf(secret, parameters).secretDigest ? parameters : null;
}
