export { qualifiedRoleName } from '#/service/role-name';
export {
  roles,
  roleComposites,
  subjectRoles,
  clientScopeRoles,
  type RoleRecord,
} from '#/schema/roles';
export { roleRepository, type NewRole, type RolePatch } from '#/repository/roles';
export {
  effectiveRoles,
  rolesReachableFrom,
  type EffectiveRole,
} from '#/repository/effective-roles';
export { groups, groupRoles, subjectGroups, type GroupRecord } from '#/schema/groups';
export {
  groupRepository,
  effectiveGroupPaths,
  ancestorsOf,
  descendantsOf,
  type NewGroup,
} from '#/repository/groups';
export { grantNewSubjectDefaults } from '#/repository/new-subject-defaults';
