import { describe, expect, it } from 'vitest';
import { failure, refusal } from '#/testing/failures';
import {
  ACCOUNT_DESCRIPTION,
  cancelPendingChange,
  confirmationOf,
  deletionRefusal,
  enabledVerb,
  pendingCancelFailure,
  pendingChangeText,
  subjectWriteFailure,
} from '#/pages/subjects/services/subjectAccount';

describe('when a subject cannot be deleted on its own', () => {
  it('says to delete the client for a service subject, which the server always refuses', () => {
    expect(deletionRefusal({ type: 'service' })).toBe(
      "This is a client's service account. Delete the client instead; it cannot be deleted on its own.",
    );
  });

  it('says to revoke an agent instance, which the server always refuses', () => {
    expect(deletionRefusal({ type: 'agent_instance' })).toBe(
      'This is an agent instance. Revoke an agent instance instead; the reaper deletes it after its retention window.',
    );
  });

  it('has nothing to say for a user', () => {
    expect(deletionRefusal({ type: 'user' })).toBeNull();
  });
});

describe('what a failed change to the account says', () => {
  it('names the subject and the verb, and keeps the server’s word for the rest', () => {
    expect(subjectWriteFailure(failure('network'), 'ada', 'deleted')).toBe(
      'Could not confirm whether ada was deleted. It has not been sent again; look at the subject before trying again.',
    );
    expect(subjectWriteFailure(failure('schema'), 'ada', 'enabled')).toBe(
      'ada may have been enabled, but the answer could not be read. Reload to check.',
    );
    expect(subjectWriteFailure(failure('defect'), 'ada', 'disabled')).toBe(
      'The console could not finish, so ada was not disabled. This is a fault in the console, not something you did.',
    );
    expect(subjectWriteFailure(refusal(403), 'ada', 'deleted')).toBe(
      'ada was not deleted: it needs the manage-users capability, or ada holds an admin capability you do not.',
    );
    expect(subjectWriteFailure(refusal(412), 'ada', 'enabled')).toBe(
      'ada changed elsewhere since you opened it, so it was not enabled. It has been read again; look at it before trying again.',
    );
    expect(subjectWriteFailure(refusal(409, { detail: 'last one' }), 'ada', 'deleted')).toBe(
      'ada was not deleted: last one',
    );
  });

  it('says enabled or disabled for what was asked', () => {
    expect(enabledVerb(true)).toBe('enabled');
    expect(enabledVerb(false)).toBe('disabled');
  });
});

describe('confirmationOf', () => {
  it('shows a question only for the one asked, with the problem that goes with it', () => {
    expect(confirmationOf('disable', 'disable', 'refused')).toEqual({
      confirming: true,
      problem: 'refused',
    });
    expect(confirmationOf('disable', 'delete', 'refused')).toEqual({
      confirming: false,
      problem: null,
    });
    expect(confirmationOf('delete', null, 'refused')).toEqual({ confirming: false, problem: null });
    expect(confirmationOf('delete', 'delete', null)).toEqual({ confirming: true, problem: null });
  });
});

describe('a pending email change', () => {
  it('names the address and says the current one stays', () => {
    expect(pendingChangeText('x@y.test')).toBe(
      'Change pending: x@y.test. The current address stays until they confirm it.',
    );
  });

  it('says nothing when none is pending', () => {
    expect(pendingChangeText(null)).toBeNull();
    expect(pendingChangeText(undefined)).toBeNull();
  });

  it('is cancelled by sending the current address back', () => {
    expect(cancelPendingChange({ email: 'ada@example.test' })).toEqual({
      email: 'ada@example.test',
    });
  });

  it('is cancelled by sending none for a subject with no current address', () => {
    expect(cancelPendingChange({ email: null })).toEqual({ email: null });
  });

  it('names the pending change when its cancel failed', () => {
    expect(pendingCancelFailure(refusal(412), 'ada')).toBe(
      'The pending change for ada changed elsewhere since you opened it, so it was not cancelled. It has been read again; look at it before trying again.',
    );
  });

  it('no longer says a changed email is unverified', () => {
    expect(ACCOUNT_DESCRIPTION).not.toMatch(/unverified/u);
  });
});
