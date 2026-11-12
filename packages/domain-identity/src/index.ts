export {
  hashPassword,
  hashUserPassword,
  matchUserPassword,
  normalisePassword,
  type PasswordMatch,
  verifyPassword,
  verifyUserPassword,
} from '#/service/password';
export { generateOneTimePassword } from '#/service/one-time-password';
export { isEmailAddress } from '#/service/email';
export { lockEmailForCreation } from '#/repository/email-lock';
export { subjects, type SubjectRecord } from '#/schema/subjects';
export { users, type UserRecord } from '#/schema/users';
export {
  userCredentials,
  type CredentialRecord,
  type CredentialType,
} from '#/schema/user-credentials';
export {
  parseCredentialSecret,
  TOTP_ALGORITHMS,
  WEBAUTHN_REQUIREMENTS,
  type CredentialSecret,
} from '#/service/credential-secret';
export {
  COMMON_PASSWORD,
  evaluatePassword,
  REUSED_PASSWORD,
  type PasswordPolicy,
  type PasswordSubject,
  type PolicyViolation,
} from '#/service/password-policy';
export {
  BREACH_CHECK_UNAVAILABLE,
  BREACHED_PASSWORD,
  BreachedLookupFailed,
  breachedHash,
  judgeBreached,
  type BreachedCheckAudit,
  type BreachedCheckMode,
  type BreachedOnError,
  type BreachedPasswordSource,
  type BreachedSettings,
  type BreachedVerdict,
} from '#/service/breached-password';
export {
  concurrencyLimiter,
  parseRange,
  remoteBreachedSource,
  REMOTE_BREACHED_CONCURRENCY_PER_TENANT,
  REMOTE_BREACHED_HOST,
  REMOTE_BREACHED_MAX_BYTES,
  REMOTE_BREACHED_TIMEOUT_MS,
  type ConcurrencyLimiter,
  type RangeFetch,
  type RangeLimit,
} from '#/service/breached-range-source';
export { breachedPasswordHashes } from '#/schema/breached-password-hashes';
export {
  breachedPasswordRepository,
  insertBreachedHashes,
  type BreachedHashRow,
} from '#/repository/breached-passwords';
export {
  createBreachedPasswordCheck,
  type BreachedPasswordCheck,
  type BreachedPasswordCheckDeps,
} from '#/usecase/breached-password-check';
export { COMMON_PASSWORD_COUNT } from '#/service/common-password';
export { passwordExpired } from '#/service/password-age';
export { isLockedOut, nextLockout, type LockoutPolicy, type LockoutState } from '#/service/lockout';
export { loginFailures } from '#/schema/login-failures';
export { pendingEmailChanges } from '#/schema/pending-email-changes';
export { pendingEmailRepository } from '#/repository/pending-emails';
export {
  loginFailureRepository,
  type LoginFailureRecord,
  type RecordFailureOutcome,
} from '#/repository/login-failures';
export { subjectRepository, type NewSubject } from '#/repository/subjects';
export { subjectIsEnabled } from '#/service/subject-enabled';
export {
  userRepository,
  type NewUser,
  type ProfileUpdate,
  type UserWithSubject,
  type VerificationUpdate,
} from '#/repository/users';
export {
  CLAIM_KEY,
  isValidBirthdate,
  isValidE164,
  isValidLocale,
  isValidProfileUrl,
  isValidZoneinfo,
  shapeInvalidityFor,
  type StringClaimKey,
} from '#/service/profile';
export {
  credentialRepository,
  type CredentialSummary,
  type NewCredential,
  type RecoveryStanding,
} from '#/repository/credentials';
