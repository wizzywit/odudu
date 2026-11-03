import { areaTitled, type Area } from '#/entities/area';

export const TOKENS_RULE =
  'A registration token lets a client register itself, within its number of uses and until it expires. Only live tokens are listed: one that is used up or has expired disappears from this list. The Audit trail holds the history.';

export const TOKEN_WORDS = {
  description: 'Initial access tokens for dynamic client registration.',
  noun: { one: 'registration token', other: 'registration tokens' },
  nothingYet:
    'No token is live. Mint one to let a client register itself, once or a few times, until it expires.',
  mint: {
    title: 'Mint a registration token',
    rule: TOKENS_RULE,
    usesLabel: 'Uses',
    usesDescription: 'How many clients may register with it.',
    usesUnit: 'uses',
    lifetimeLabel: 'Lifetime',
    lifetimeDescription: 'How long it stays live.',
    lifetimeUnit: 'seconds',
    submit: 'Mint token',
    minting: 'Minting…',
    last: 'Last mint',
  },
  columns: {
    token: 'Token',
    usesLeft: 'Uses left',
    minted: 'Minted',
    expires: 'Expires',
    revoke: 'Revoke',
  },
  lastRevoke: 'Last revoke',
  secret: {
    title: 'New registration token',
    label: 'registration token',
    note: 'A client presents it to register itself.',
  },
  revoke: { title: 'Revoke this token?', confirm: 'Revoke token' },
} as const;

export type TokenWords = typeof TOKEN_WORDS;

export function revokeLabel(id: string): string {
  return `Revoke ${id}`;
}

export function tokensArea(): { area: Area; title: string } {
  return areaTitled('registration-tokens');
}
