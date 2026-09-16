// Shared between the service layer (which produces it) and the repository
// layer (which persists nothing further about it, but needs the type to hand
// results back through `advance`) — kept here, not in repository, so a
// repository file importing it never counts as service depending on
// repository (dependency-cruiser's service-is-a-leaf rule).
export type AuthenticatorResult =
  // `commit` is state a factor verified but must not write yet. An
  // authenticator that names its own subject, rather than being handed one,
  // must not write anything itself: `advance` has not yet checked that this
  // attempt is that subject's, so a direct write can move a stranger's
  // credential. Return the write here instead and `advance` runs it once
  // that check has passed; false refuses the login.
  | { kind: 'success'; subjectId: string; commit?: () => Promise<boolean> }
  // `form` names the authenticator whose fields the caller should render —
  // a registry key (#/usecase/executor's AUTHENTICATORS), not a fixed enum,
  // so a new authenticator needs no change here to be challengeable.
  | { kind: 'challenge'; form: string }
  | { kind: 'failure'; reason: string };
