import { describe, expect, it } from 'vitest';
import {
  ASSIGNMENTS,
  assignedText,
  assignmentOf,
  unassignedText,
} from '#/features/scope-assignment/services/assignmentWords';

describe('a scope assigned to a client', () => {
  it('offers default and optional', () => {
    expect(ASSIGNMENTS.map((each) => each.id)).toEqual(['default', 'optional']);
  });

  it('narrows a chosen assignment to one the server holds', () => {
    expect(assignmentOf('optional')).toBe('optional');
    expect(assignmentOf('anything else')).toBe('default');
  });

  it('says what happened, naming the scope and the client', () => {
    expect(assignedText('reports:read', 'billing', 'optional')).toBe(
      'reports:read is assigned to billing as optional.',
    );
    expect(unassignedText('reports:read', 'billing')).toBe(
      'reports:read is no longer assigned to billing.',
    );
  });
});
