import { describe, expect, it } from 'vitest';
import {
  auditFileName,
  eventsIn,
  exportFailureText,
  savedText,
} from '#/pages/audit/services/auditExport';
import type { GatewayFailure } from '#/shared/lib/services/result';

describe('the file an export is saved as', () => {
  it('is named for the tenant and the UTC day', () => {
    expect(auditFileName('acme', new Date('2026-10-12T23:59:00Z'))).toBe(
      'acme-audit-2026-10-12.ndjson',
    );
  });

  it('counts the events by the lines it holds, never an empty one', () => {
    expect(eventsIn('{"a":1}\n{"a":2}\n')).toBe(2);
    expect(eventsIn('')).toBe(0);
    expect(eventsIn('{"a":1}\n\n{"a":2}')).toBe(2);
  });

  it('says what was saved', () => {
    expect(savedText('acme-audit-2026-10-12.ndjson', 1)).toBe(
      'Saved acme-audit-2026-10-12.ndjson, 1 event.',
    );
    expect(savedText('x.ndjson', 12_345)).toBe('Saved x.ndjson, 12,345 events.');
  });
});

describe('why an export did not happen', () => {
  const problem = (status: number, type = 'about:blank', detail?: string): GatewayFailure => ({
    ok: false,
    kind: 'problem',
    problem: {
      type,
      title: `T${String(status)}`,
      status,
      ...(detail === undefined ? {} : { detail }),
    },
  });

  it('names the capability, when the server refused it', () => {
    expect(exportFailureText(problem(403), true)).toBe('Exporting the trail needs view-audit.');
  });

  it('says the filters match more than an export holds, and to narrow them', () => {
    const text = exportFailureText(problem(413, 'about:blank#export-too-large'), false);
    expect(text).toMatch(/10,000/u);
    expect(text).toMatch(/Narrow the filters/u);
  });

  it('says a read the server stopped at its bound needs a time range', () => {
    expect(
      exportFailureText(problem(400, 'about:blank#audit-query-too-broad', 'x'), false),
    ).toMatch(/could not be exported in time. Choose a time range/u);
  });

  it("gives the server's words for another refusal", () => {
    expect(
      exportFailureText(problem(400, 'about:blank', 'resource_id requires resource_type'), false),
    ).toBe('resource_id requires resource_type');
  });

  it('says nothing was saved when the answer never came', () => {
    expect(exportFailureText({ ok: false, kind: 'network' }, false)).toMatch(/Nothing was saved/u);
  });
});
