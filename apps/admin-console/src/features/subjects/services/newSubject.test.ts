import { describe, expect, it } from 'vitest';
import {
  createSubjectHref,
  manageUsersRefusal,
  newSubjectSpec,
  subjectCreatedText,
} from '#/features/subjects/services/newSubject';
import { createFailure } from '#/shared/services/failure';
import { failure, refusal } from '#/testing/failures';

describe('creating a subject', () => {
  it('offers creating only while nothing rules it out', () => {
    expect(createSubjectHref('acme', [])).toBe('/console/acme/subjects/new');
    expect(createSubjectHref('acme', ['manage-users'])).toBeNull();
  });
});

describe('the words of creating a subject', () => {
  it('says where the password comes from', () => {
    expect(subjectCreatedText('ada')).toBe(
      'ada was created. It has no password yet: issue a one-time password from its Credentials tab.',
    );
  });

  it('words a refusal and an unreadable answer its own way, and places a rejected field', () => {
    const spec = newSubjectSpec('ada');
    expect(createFailure(refusal(403), spec)).toMatchObject({
      report: true,
      message: 'ada was not created: it needs the manage-users capability.',
    });
    expect(createFailure(failure('schema'), spec)).toMatchObject({
      unconfirmed: true,
      message: 'ada may have been created, but the answer could not be read. Look for it.',
    });
    expect(createFailure(failure('network'), spec).message).toBe(
      'Could not confirm whether ada was created. It has not been sent again; look for it before trying again.',
    );
    expect(createFailure(failure('defect'), spec).message).toBe(
      'The console could not create the subject. This is a fault in the console, not something you did.',
    );
    const rejected = refusal(400, { errors: [{ path: 'email', message: 'invalid' }] });
    expect(createFailure(rejected, spec)).toMatchObject({
      errors: { email: 'invalid' },
      report: false,
    });
    expect(createFailure(refusal(409, { detail: 'taken' }), spec).report).toBe(false);
  });
});

describe('small model reads', () => {
  it('names manage-users as what refuses creating, once whoami has ruled it out', () => {
    expect(manageUsersRefusal(undefined)).toBeNull();
    expect(manageUsersRefusal({ capabilities: ['manage-users'] } as never)).toBeNull();
    expect(manageUsersRefusal({ capabilities: [] } as never)).toBe('manage-users');
  });
});
