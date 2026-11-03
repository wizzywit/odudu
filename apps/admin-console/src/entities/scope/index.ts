export type { AssignedScopes, Scope, ScopeAssignment } from '#/entities/scope/types/scope';
export { useScopePicker } from '#/entities/scope/use-cases/scopePicker';
export { readScopePage } from '#/entities/scope/use-cases/scopeLists';
export { assignScope, unassignScope } from '#/entities/scope/use-cases/scopeCalls';
export {
  newScopeHref,
  scopeHref,
  scopesHref,
  scopesTrail,
} from '#/entities/scope/services/scopeAddress';
