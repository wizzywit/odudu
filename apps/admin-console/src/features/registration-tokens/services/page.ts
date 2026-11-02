export const NOUN = { one: 'registration token', other: 'registration tokens' } as const;

export const TOKENS_RULE =
  'A registration token lets a client register itself, within its number of uses and until it expires. Only live tokens are listed: one that is used up or has expired disappears from this list. The Audit trail holds the history.';

export const NOTHING_YET =
  'No token is live. Mint one to let a client register itself, once or a few times, until it expires.';
