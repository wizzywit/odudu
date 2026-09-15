// Shared between the service layer (which produces it) and the repository
// layer (which persists nothing further about it, but needs the type to hand
// results back through `advance`) — kept here, not in repository, so a
// repository file importing it never counts as service depending on
// repository (dependency-cruiser's service-is-a-leaf rule).
export type AuthenticatorResult =
  | { kind: 'success'; subjectId: string }
  // `form` names the authenticator whose fields the caller should render —
  // a registry key (#/usecase/executor's AUTHENTICATORS), not a fixed enum,
  // so a new authenticator needs no change here to be challengeable.
  | { kind: 'challenge'; form: string }
  | { kind: 'failure'; reason: string };
