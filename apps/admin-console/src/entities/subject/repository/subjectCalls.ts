export { readSubjectCount, readSubjectPage } from '#/entities/subject/adapter/subjectList';
export {
  createSubject,
  findSubject,
  issuePassword,
} from '#/entities/subject/adapter/subjectCreation';
export { readSubjectRoles, setSubjectRoles } from '#/entities/subject/adapter/subjectRoles';
export { amendSubject, deleteSubject, readSubject } from '#/entities/subject/adapter/subjectRecord';
export {
  readAdminCapabilities,
  readAdminRoles,
  readEffectiveRoles,
  readRequiredActions,
  readSubjectGroups,
  setRequiredActions,
  setSubjectGroups,
} from '#/entities/subject/adapter/subjectAccess';
