// Every length is bounded, so the pattern costs at most a fixed number of
// steps from each starting point and a long hostile string stays linear. A
// local part is at most 64 characters (RFC 5321), and a run of more than that
// before an `@` is no address, so it is left alone.
const ADDRESS =
  /(?<![A-Za-z0-9._%+-])([A-Za-z0-9._%+-]{1,64})@((?:[A-Za-z0-9-]{1,63}\.){1,8}[A-Za-z]{2,24})(?![A-Za-z0-9-])/gu;

/**
 * Replaces each email address in `text` by its first character, three
 * asterisks and its domain (`ada@example.com` becomes `a***@example.com`), so
 * the model can still tell people apart by domain and a person can still read
 * which kind of address was meant. The domain is kept on purpose; it is not
 * hidden from the provider. Masking a masked text changes nothing.
 */
export function maskEmailAddresses(text: string): string {
  return text.replace(ADDRESS, (_whole, local: string, domain: string) => {
    return `${local.slice(0, 1)}***@${domain}`;
  });
}
