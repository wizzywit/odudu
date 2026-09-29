// The OIDC Core §5.1 claim shapes live in @odudu/contracts, where the
// console reads them too; profile.int.test.ts proves the CHECK constraints
// of packages/db/drizzle/0020_user_profile.sql agree with them.
export {
  isValidBirthdate,
  isValidE164,
  isValidLocale,
  isValidProfileUrl,
  isValidZoneinfo,
} from '@odudu/contracts';
