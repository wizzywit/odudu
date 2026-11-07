import { describe, expect, it } from 'vitest';
import { memoryWriteBudget, type BudgetKind } from '#/service/write-budget';
import { updateThemeDraftTool } from '#/service/tools/theme-write';
import type { AdminCaller, AdminRequestSpec, AdminResult } from '#/service/tool';
import { callMcpTool } from '#/usecase/call-mcp-tool';

const ETAG = `"${'a'.repeat(64)}"`;
const NEW_ETAG = `"${'b'.repeat(64)}"`;
const CSS = { stylesheet: '.page { color: red; }' };

const EMPTY_BODY = { tokens: {}, stylesheet: null, templates: {}, assets: {} };

function view(draft: object | null): unknown {
  return {
    scope: 'tenant',
    draft,
    published: null,
    sources: {},
    draft_sources: draft === null ? null : {},
    tenant_sources: null,
    changed: [],
  };
}

const ok = (body: unknown, etag?: string): AdminResult => ({
  status: 200,
  headers: etag === undefined ? {} : { etag },
  body,
});

function sequence(...answers: AdminResult[]): AdminCaller & { requests: AdminRequestSpec[] } {
  const requests: AdminRequestSpec[] = [];
  return {
    requests,
    call(request) {
      requests.push(request);
      const answer = answers[Math.min(requests.length - 1, answers.length - 1)];
      if (answer === undefined) throw new Error('no answer scripted');
      return Promise.resolve(answer);
    },
  };
}

function depsWith(budget: ReturnType<typeof memoryWriteBudget>, reserved: BudgetKind[]) {
  return {
    requestId: 'r',
    deadlineMs: 20_000,
    budget: {
      reserve: (kind: BudgetKind) => {
        reserved.push(kind);
        return budget.reserve(kind);
      },
      release: (kind: BudgetKind) => budget.release(kind),
    },
    record: () => Promise.resolve(),
    logger: { error: () => undefined },
  };
}

describe('the budget a theme draft spends', () => {
  it('is a create place when no etag is named, which asks for the first draft', async () => {
    const reserved: BudgetKind[] = [];
    await callMcpTool(
      depsWith(memoryWriteBudget(), reserved),
      updateThemeDraftTool,
      sequence(ok(view(null)), ok(view(EMPTY_BODY), NEW_ETAG)),
      CSS,
    );
    expect(reserved).toEqual(['create']);
  });

  it('is a mutating place when an etag is named, which replaces a draft', async () => {
    const reserved: BudgetKind[] = [];
    const result = await callMcpTool(
      depsWith(memoryWriteBudget(), reserved),
      updateThemeDraftTool,
      sequence(ok(view(EMPTY_BODY), ETAG), ok(view(EMPTY_BODY), NEW_ETAG)),
      { ...CSS, if_match: ETAG },
    );
    expect(result.isError, JSON.stringify(result.structuredContent)).toBe(false);
    expect(reserved).toEqual(['mutating']);
  });

  it('is given back for a call the tool or the admin API refused with a 4xx, so it can be made again', async () => {
    const deps = depsWith(memoryWriteBudget({ mutating: 1, creates: 1 }), []);
    // A draft exists and no etag was named: the tool's own 412, nothing sent.
    const refused = await callMcpTool(
      deps,
      updateThemeDraftTool,
      sequence(ok(view(EMPTY_BODY), ETAG)),
      CSS,
    );
    expect(refused.isError).toBe(true);
    const next = await callMcpTool(
      deps,
      updateThemeDraftTool,
      sequence(ok(view(null)), ok(view(EMPTY_BODY), NEW_ETAG)),
      CSS,
    );
    expect(next.isError, JSON.stringify(next.structuredContent)).toBe(false);
    // And the allowance of one is now spent, whatever the next call is.
    const spent = await callMcpTool(
      deps,
      updateThemeDraftTool,
      sequence(ok(view(null)), ok(view(EMPTY_BODY), NEW_ETAG)),
      CSS,
    );
    expect(spent.structuredContent).toMatchObject({ error: { type: 'mcp:write_budget' } });
  });
});
