// Shared between the service layer (which produces it) and the repository
// layer (which persists nothing further about it, but needs the type to hand
// results back through `advance`) — kept here, not in repository, so a
// repository file importing it never counts as service depending on
// repository (dependency-cruiser's service-is-a-leaf rule).
export type AuthenticatorResult =
  | { kind: 'success'; subjectId: string }
  | { kind: 'challenge'; form: 'password' }
  | { kind: 'failure'; reason: string };
