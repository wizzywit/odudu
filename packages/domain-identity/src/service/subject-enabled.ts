// Disabling a subject ends nothing it holds, so every door that accepts a
// token it was issued asks this of the token's subject: `/userinfo`,
// `/introspect`, token exchange, refresh and the admin API alike. A
// subject that no longer exists is not an enabled one.
export function subjectIsEnabled(subject: { readonly disabledAt: Date | null } | null): boolean {
  return subject !== null && subject.disabledAt === null;
}
