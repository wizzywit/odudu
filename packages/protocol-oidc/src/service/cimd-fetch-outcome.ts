export type CimdFetchRefusal =
  | 'private_address'
  | 'url_refused'
  | 'unreachable'
  | 'redirect'
  | 'too_large'
  | 'timeout'
  | 'not_json'
  | 'status';

export type CimdFetchOutcome =
  | {
      readonly kind: 'ok';
      readonly body: unknown;
      readonly expiresAt: Date;
      /** False for a `no-store` response: it is used for this request and kept nowhere. */
      readonly cacheable: boolean;
    }
  | { readonly kind: 'refused'; readonly reason: CimdFetchRefusal };
