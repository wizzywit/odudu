import { formatAbsolute, counted } from '#/shared/services/format';
import { type CreateOutcome, createFailure, refusedBy } from '#/shared/services/failure';
import type { GatewayFailure } from '#/shared/services/result';
import { MINT_FIELDS } from '#/pages/registration-tokens/services/mint';

const LOST =
  'The token may have been created, but the answer could not be read, so it cannot be shown. Look at the list: revoke any token you did not receive, then mint another.';

export function mintFailure(failure: GatewayFailure): CreateOutcome {
  return createFailure(failure, {
    noun: 'registration token',
    name: 'the token',
    fields: MINT_FIELDS,
    capability: 'manage-clients',
    schema: LOST,
    refused: refusedBy('manage-clients'),
  });
}

export function mintedText(token: { remaining_uses: number; expires_at: string }): string {
  return `Registration token minted: ${counted(token.remaining_uses, 'use', 'uses')}, until ${formatAbsolute(new Date(token.expires_at))}.`;
}
