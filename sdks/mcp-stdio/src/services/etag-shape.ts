// One strong entity tag as the admin API makes it: a quoted run of printable
// ASCII with no quote, comma or wildcard in it, so a value that passes is one
// validator and never a list, a weak tag or a way to add a header line. Written
// without a flag so the JSON schema a client lists carries it too.
export const ETAG_PATTERN = /^"[\x21\x23-\x2b\x2d-\x7e]{1,126}"$/;

export const ETAG_MAX_LENGTH = 128;

export function isEtag(value: unknown): value is string {
  return typeof value === 'string' && value.length <= ETAG_MAX_LENGTH && ETAG_PATTERN.test(value);
}
