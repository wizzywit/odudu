// OIDC Core §5.1 requires the `email` claim's value to conform to RFC 5322's
// addr-spec. That obligation runs one way — what Odudu emits must be a valid
// addr-spec — and says nothing about accepting every addr-spec a mail system
// might, which is just as well: full addr-spec admits quoted local parts,
// parenthesised comments, folding whitespace and domain literals, and a
// regular expression claiming to implement all of it and getting it subtly
// wrong is worse than a narrower rule that says plainly what it enforces.
//
// So this enforces a strict subset, chosen so that everything accepted is
// unambiguously a valid addr-spec:
//
//   - a dot-atom local part: RFC 5322 §3.2.3's atext characters in
//     dot-separated components, no empty component, so no leading, trailing
//     or doubled dot;
//   - a dot-atom domain of at least two labels, each label alphanumeric with
//     internal hyphens. Two labels because an `email` claim exists to be
//     delivered to and a single-label domain is not globally routable;
//   - RFC 5321 §4.5.3.1's octet limits: 64 for the local part, 254 for the
//     whole address.
//
// What it refuses that addr-spec allows: quoted local parts, comments, any
// whitespace, domain literals (`alice@[192.0.2.1]`), and single-label
// domains. A user whose real address needs one of those cannot be stored
// today; raising the ceiling means implementing the grammar, not widening
// the pattern.
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
