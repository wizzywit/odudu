import { isUniqueViolation, type TenantScopedDatabase } from '@odudu/db';
import { auditRepository } from '@odudu/domain-audit';
import { planProfileAmend, userRepository, type UserRecord } from '@odudu/domain-identity';
import { sql } from 'drizzle-orm';
import { requiredActionRepository } from '#/repository/required-actions';
import { tenantSettingsRepository } from '#/repository/tenant-settings';
import {
  editableProfileFields,
  prefilledValues,
  submittedValues,
  unfilledFields,
} from '#/service/profile-form';

// What the page shows: the fields the person may edit at this tenant, in
// order, and what they hold in each.
export interface ProfileOffer {
  fields: readonly string[];
  values: Record<string, string>;
}

export type ProfileProblem =
  | { kind: 'unfilled'; fields: readonly string[] }
  | { kind: 'invalid'; field: string; reason: 'bidi' | 'shape' }
  | { kind: 'username_taken' };

export type UpdateProfileOutcome =
  | { kind: 'completed' }
  // `values` is what the form goes back with: what was typed, over what is held.
  | { kind: 'rejected'; problems: readonly ProfileProblem[]; values: Record<string, string> };

export interface UpdateProfile {
  tenantId: string;
  subjectId: string;
  // The form as posted; only the editable fields are read from it.
  posted: Readonly<Record<string, string>>;
}

// What the form goes back with: what was typed, over what is held.
function redisplayed(
  current: UserRecord,
  fields: readonly string[],
  posted: Readonly<Record<string, string>>,
): Record<string, string> {
  const shown = { ...prefilledValues(current, fields) };
  for (const field of fields) {
    const typed = posted[field];
    if (typed !== undefined) shown[field] = typed;
  }
  return shown;
}

// False where the index refused the name, with the transaction left usable.
async function renamed(
  tx: TenantScopedDatabase,
  subjectId: string,
  username: string,
): Promise<boolean> {
  await tx.execute(sql`savepoint rename_user`);
  try {
    await userRepository(tx).updateUsername(subjectId, username);
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    await tx.execute(sql`rollback to savepoint rename_user`);
    return false;
  }
  await tx.execute(sql`release savepoint rename_user`);
  return true;
}

export async function profileOffer(
  tx: TenantScopedDatabase,
  tenantId: string,
  subjectId: string,
): Promise<ProfileOffer> {
  const { usernameEditable } = await tenantSettingsRepository(tx).accountActionSettings(tenantId);
  const user = await userRepository(tx).bySubjectId(subjectId);
  const fields = editableProfileFields(usernameEditable);
  return { fields, values: user === null ? {} : prefilledValues(user, fields) };
}

// Written only when the whole form is acceptable: every value the write would
// accept (the validation `PATCH /me/profile` applies), every field that was
// empty now filled, and a username nobody else holds. Otherwise nothing is
// written and the form comes back with what was typed.
export async function completeUpdateProfile(
  tx: TenantScopedDatabase,
  input: UpdateProfile,
): Promise<UpdateProfileOutcome> {
  const { usernameEditable } = await tenantSettingsRepository(tx).accountActionSettings(
    input.tenantId,
  );
  const users = userRepository(tx);
  const current = await users.lockBySubjectId(input.subjectId);
  const fields = editableProfileFields(usernameEditable);
  if (current === null) return { kind: 'completed' };

  const submitted = submittedValues(input.posted, fields);
  const problems: ProfileProblem[] = [];
  const unfilled = unfilledFields(current, submitted, fields);
  if (unfilled.length > 0) problems.push({ kind: 'unfilled', fields: unfilled });

  const plan = planProfileAmend(current, submitted);
  if (plan.kind === 'invalid_value') {
    problems.push({ kind: 'invalid', field: plan.field, reason: plan.reason });
  }
  if (plan.kind === 'change' && plan.username !== null) {
    const holder = await users.byUsername(plan.username);
    if (holder !== null && holder.user.subjectId !== input.subjectId) {
      problems.push({ kind: 'username_taken' });
    }
  }
  if (problems.length > 0) {
    return { kind: 'rejected', problems, values: redisplayed(current, fields, input.posted) };
  }

  if (plan.kind === 'change') {
    // The username first, in a savepoint: a name another person claimed since
    // it was looked at is refused by the index, and nothing of the form is
    // written then.
    if (plan.username !== null && !(await renamed(tx, input.subjectId, plan.username))) {
      return {
        kind: 'rejected',
        problems: [{ kind: 'username_taken' }],
        values: redisplayed(current, fields, input.posted),
      };
    }
    // Unverified first: the row never holds a verified number it is changing.
    if (plan.verification !== null) await users.setVerification(input.subjectId, plan.verification);
    if (plan.profile !== null) await users.updateProfile(input.subjectId, plan.profile);
    await auditRepository(tx).record({
      eventType: 'admin_mutation',
      action: 'subject.profile_amend',
      outcome: 'allowed',
      actorSubjectId: input.subjectId,
      resourceType: 'subject',
      resourceId: input.subjectId,
      detail: { via: 'required_action', fields: [...plan.fields] },
    });
  }
  await requiredActionRepository(tx).complete(input.subjectId, 'update-profile');
  return { kind: 'completed' };
}
