import { describe, expect, it } from 'vitest';
import {
  actorName,
  actorNote,
  auditActorOf,
  elsewhereNoteOf,
  elsewhereReason,
  ELSEWHERE_NOTE,
  isElsewhere,
} from '#/entities/audit-event/services/actorOrigin';

describe('a caller from elsewhere', () => {
  it('is a system administrator or a token another tenant issued', () => {
    expect(isElsewhere('system')).toBe(true);
    expect(isElsewhere('other-tenant')).toBe(true);
    expect(isElsewhere('tenant')).toBe(false);
    expect(isElsewhere(null)).toBe(false);
  });

  it('says why no name is shown, for each kind', () => {
    expect(elsewhereReason('system')).toMatch(/system administrator/u);
    expect(elsewhereReason('other-tenant')).toMatch(/another tenant/u);
    expect(elsewhereReason('tenant')).toBeNull();
    expect(elsewhereReason(null)).toBeNull();
  });
});

describe('the name an actor is shown under', () => {
  it('is what a caller from elsewhere is, whatever name the row carries', () => {
    expect(actorName({ actor_name: 'ada', actor_origin: 'system' })).toBe('a system administrator');
    expect(actorName({ actor_name: null, actor_origin: 'other-tenant' })).toBe(
      "another tenant's caller",
    );
  });

  it('is the name the API resolved for a caller of this tenant, or none', () => {
    expect(actorName({ actor_name: 'grace', actor_origin: 'tenant' })).toBe('grace');
    expect(actorName({ actor_name: null, actor_origin: 'tenant' })).toBeNull();
    expect(actorName({ actor_name: null, actor_origin: null })).toBeNull();
  });
});

describe('what is said of an actor beside its id', () => {
  it('explains a caller from elsewhere', () => {
    expect(actorNote({ actor_subject_id: 's', actor_name: null, actor_origin: 'system' })).toBe(
      elsewhereReason('system'),
    );
  });

  it('explains a missing name for an actor of this tenant', () => {
    expect(actorNote({ actor_subject_id: 's', actor_name: null, actor_origin: 'tenant' })).toMatch(
      /view-users/u,
    );
  });

  it('says nothing where the name is shown, or no subject acted', () => {
    expect(
      actorNote({ actor_subject_id: 's', actor_name: 'grace', actor_origin: 'tenant' }),
    ).toBeNull();
    expect(actorNote({ actor_subject_id: null, actor_name: null, actor_origin: null })).toBeNull();
  });
});

describe('the note under a table', () => {
  it('is there when a row is from elsewhere and not otherwise', () => {
    expect(elsewhereNoteOf([{ actor_origin: 'tenant' }, { actor_origin: 'other-tenant' }])).toBe(
      ELSEWHERE_NOTE,
    );
    expect(elsewhereNoteOf([{ actor_origin: 'tenant' }, { actor_origin: null }])).toBeNull();
    expect(elsewhereNoteOf([])).toBeNull();
  });
});

describe('who an audit row says acted', () => {
  it('is the name shown and whether the caller is from elsewhere', () => {
    expect(auditActorOf({ actor_name: 'grace', actor_origin: 'tenant' })).toEqual({
      name: 'grace',
      elsewhere: false,
    });
    expect(auditActorOf({ actor_name: 'ada', actor_origin: 'system' })).toEqual({
      name: 'a system administrator',
      elsewhere: true,
    });
  });
});
