-- OIDC Core §5.1 requires the `email` claim to conform to RFC 5322's
-- addr-spec. The claim is emitted verbatim from this column
-- (packages/protocol-oidc/src/service/claims.ts), so the column is where the
-- obligation is either true or not. A repository method cannot make it true:
-- it constrains one writer, and the claim is produced from whatever the row
-- holds however it got there.
--
-- The accepted form is the stated subset of addr-spec described in
-- packages/domain-identity/src/service/email.ts — dot-atom local part,
-- dot-atom domain of at least two labels, RFC 5321 §4.5.3.1's 64/254 octet
-- limits — and not the full grammar. The two spellings of that subset, this
-- predicate and `isEmailAddress`, are held in agreement case by case by the
-- parity assertion in packages/domain-identity/tests/identity.int.test.ts.
--
-- NULL passes, as a CHECK on a NULL always does: no address on file is a
-- valid state, and the claim mapper omits `email` entirely for it.
--
-- A database already holding an address outside this subset makes this
-- statement fail rather than silently marking the rows suspect. That is the
-- intended behaviour; there is no repair step here because there is no
-- deployment yet whose data could need one.
ALTER TABLE users ADD CONSTRAINT users_email_addr_spec CHECK (
  email IS NULL
  OR (
    length(email) <= 254
    AND strpos(email, '@') - 1 <= 64
    AND email ~ '^[A-Za-z0-9!#$%&''*+/=?^_`{|}~-]+(\.[A-Za-z0-9!#$%&''*+/=?^_`{|}~-]+)*@[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$'
  )
);
