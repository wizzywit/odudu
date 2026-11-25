import { expect, it } from 'vitest';
import {
  countOf,
  revokeConsequence,
  revokedText,
  revokeFailure,
  revokeDialogOf,
  revokeHeld,
  revokeRetry,
  revokeTargetOf,
} from '#/pages/agents/services/revoke';
import type { Read } from '#/shared/lib/services/read';
import type { RevokeCount } from '#/pages/agents/types/agent';

const retry = (): void => undefined;
const ready = (data: RevokeCount): Read<RevokeCount> => ({ status: 'ready', data });

it('reads the dry count as counted, and a count not read as unknown, never as none', () => {
  expect(countOf({ status: 'loading' })).toEqual({ kind: 'reading' });
  expect(countOf({ status: 'failed', refused: false, retry })).toEqual({ kind: 'unknown' });
  expect(countOf(ready({ grants: 2, instances: 3 }))).toEqual({
    kind: 'counted',
    grants: 2,
    instances: 3,
  });
});

it('holds the revoke until the counts are in', () => {
  expect(revokeHeld({ kind: 'reading' })).toBe(true);
  expect(revokeHeld({ kind: 'unknown' })).toBe(true);
  expect(revokeHeld({ kind: 'counted', grants: 0, instances: 0 })).toBe(false);
});

it('says how many instances and grants a revoke ends, once they are counted', () => {
  expect(revokeConsequence('planner', { kind: 'counted', grants: 2, instances: 3 })).toBe(
    'Revoking this run of planner ends 3 instances, this one and every run started beneath it, and revokes 2 grants. The tokens those grants hold stop working at once. This cannot be undone.',
  );
  expect(revokeConsequence('planner', { kind: 'counted', grants: 1, instances: 1 })).toContain(
    'ends 1 instance, this one and every run started beneath it, and revokes 1 grant.',
  );
});

it('says while the counts are being read, and that they could not be', () => {
  expect(revokeConsequence('planner', { kind: 'reading' })).toBe(
    'Checking what revoking this run of planner ends…',
  );
  expect(revokeConsequence('planner', { kind: 'unknown' })).toContain(
    'could not be read, so the revoke is held',
  );
});

it('offers to read again only where the read failed', () => {
  expect(revokeRetry({ status: 'loading' })).toBeNull();
  expect(revokeRetry({ status: 'failed', refused: false, retry })).toMatchObject({
    label: 'Read again',
    run: retry,
  });
});

it('says what a revoke came to', () => {
  expect(revokedText('planner', { grants: 2, instances: 3 })).toBe(
    'The run of planner ended: 3 instances and 2 grants.',
  );
  expect(revokedText('planner', { grants: 0, instances: 0 })).toBe(
    'The run of planner had already ended, so nothing more was ended.',
  );
});

it('says the refusals in the words of the capability or the ceiling, and that a lost run is gone', () => {
  expect(
    revokeFailure({
      ok: false,
      kind: 'problem',
      problem: { type: 'about:blank', title: 'Not Found', status: 404 },
    }),
  ).toBe('This run is gone: it may have been removed since the list was read.');
  expect(
    revokeFailure({
      ok: false,
      kind: 'problem',
      problem: { type: 'about:blank', title: 'Forbidden', status: 403 },
    }),
  ).toContain('manage-sessions');
  expect(revokeFailure({ ok: false, kind: 'network' })).toContain(
    'Could not confirm whether the revoke of this run was done.',
  );
});

it('draws no confirmation until a revoke is asked, then holds it with the counts', () => {
  expect(revokeDialogOf(null, { kind: 'reading' })).toBeNull();
  expect(revokeDialogOf({ agentClient: 'planner' }, { kind: 'reading' })).toEqual({
    title: 'Revoke the run of planner?',
    consequence: 'Checking what revoking this run of planner ends…',
    held: true,
  });
  expect(
    revokeDialogOf({ agentClient: 'planner' }, { kind: 'counted', grants: 0, instances: 1 })?.held,
  ).toBe(false);
});

it('reads the count only for a run that is being asked about', () => {
  expect(revokeTargetOf({ id: 'i1' })).toEqual({ id: 'i1', asked: true });
  expect(revokeTargetOf(null)).toEqual({ id: '', asked: false });
});
