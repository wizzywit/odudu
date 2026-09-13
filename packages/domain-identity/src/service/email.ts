// A strict subset of RFC 5322's addr-spec, every member of which is
// unambiguously one: dot-atom local part (§3.2.3 atext, no empty component),
// dot-atom domain of two or more labels, RFC 5321 §4.5.3.1's octet limits.
// Quoted local parts, comments, whitespace and domain literals are refused.
// Why a subset rather than the grammar, and what it costs: see
// docs/protocols/oidc-core.md, "§5.1's `email`: a subset of addr-spec".
// packages/db/drizzle/0012_users_email_addr_spec.sql spells the same subset
// in SQL, and is what constrains the column the claim is read from.
const ATEXT = "[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]";
const LOCAL_PART = `${ATEXT}+(?:\\.${ATEXT}+)*`;
const DOMAIN_LABEL = '[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?';
const DOMAIN = `${DOMAIN_LABEL}(?:\\.${DOMAIN_LABEL})+`;

const ADDR_SPEC = new RegExp(`^${LOCAL_PART}@${DOMAIN}$`, 'u');

const MAX_LOCAL_PART_OCTETS = 64;
const MAX_ADDRESS_OCTETS = 254;

export function isEmailAddress(value: string): boolean {
  if (value.length > MAX_ADDRESS_OCTETS) return false;
  if (!ADDR_SPEC.test(value)) return false;
  const at = value.lastIndexOf('@');
  return at <= MAX_LOCAL_PART_OCTETS;
}
