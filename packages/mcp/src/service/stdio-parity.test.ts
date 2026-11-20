import { loadCatalogue, toolsOf } from '@odudu-io/mcp-stdio';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { TOOLS } from '#/service/catalogue';
import type { RegisteredTool } from '#/service/tool';
import { directCallerTools } from '#/service/visible-tools';
import { exampleOf } from '#/testing/example-of';
import { respondingWith } from '#/testing/fake-caller';

// The stdio client reads the generated catalogue, the endpoint runs the Zod
// tools. They are two implementations of one tool, so each tool is held to
// answering a call, and refusing a bad one, as its twin does.

const UUID = '0192a0a0-0000-7000-8000-000000000001';
const ETAG = `"${'a'.repeat(64)}"`;
const direct = directCallerTools(TOOLS);
const shipped = new Map(toolsOf(loadCatalogue()).map((tool) => [tool.name, tool]));

// Responses whose Zod schema holds a refinement across members (which
// authenticator settings a step may carry). JSON Schema has no way to say it, so
// the client reads such an answer by its shape alone, and an answer with a
// member added to it can pass here where the endpoint refuses it.
const REFINED = new Set(['get_flow', 'get_flow_executions', 'list_flows']);

function twin(name: string) {
  const found = shipped.get(name);
  if (found === undefined) throw new Error(`the catalogue has no ${name}`);
  return found;
}

function argumentsFor(tool: RegisteredTool): Record<string, unknown> {
  if (tool.access === 'write') {
    const [field] = tool.bodyFields ?? [];
    return { id: UUID, if_match: ETAG, [field ?? 'description']: 'x' };
  }
  const schema = z.toJSONSchema(tool.input, { io: 'input' });
  return Object.fromEntries(
    (schema.required ?? []).map((name) => [name, name === 'id' ? UUID : 'x']),
  );
}

function withExtras(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withExtras);
  if (typeof value !== 'object' || value === null) return value;
  return {
    ...Object.fromEntries(Object.entries(value).map(([key, item]) => [key, withExtras(item)])),
    unlisted_member: 'must not reach a model',
    client_secret: 'must not reach a model',
  };
}

async function outcome(
  tool: Pick<RegisteredTool, 'run'>,
  input: Record<string, unknown>,
  body: unknown,
  status = 200,
) {
  const caller = respondingWith(body, status, { etag: ETAG });
  try {
    return { result: await tool.run(caller, input), requests: caller.requests };
  } catch (error) {
    if (error instanceof Error && 'problemType' in error) {
      return { problem: error.problemType, requests: caller.requests };
    }
    throw error;
  }
}

describe('the catalogue file against the tools it was generated from', () => {
  it('lists every tool a direct caller may serve, and no other', () => {
    expect([...shipped.keys()]).toEqual(direct.map((tool) => tool.name));
  });

  it.each(direct.map((tool) => [tool.name, tool] as const))('%s is the same tool', (name, tool) => {
    const other = twin(name);
    expect(other.description).toBe(tool.description);
    expect(other.routeKey).toBe(tool.routeKey);
    expect(other.access).toBe(tool.access);
    expect(other.spends).toBe(tool.spends);
    expect(other.bodyFields).toEqual(tool.bodyFields);
    expect(other.annotations).toEqual(tool.annotations);
    expect(other.tooLargeDetail).toBe(tool.tooLargeDetail);
    expect(other.inputSchema).toEqual(
      tool.input['~standard'].jsonSchema.input({ target: 'draft-2020-12' }),
    );
  });

  it.each(direct.map((tool) => [tool.name, tool] as const))(
    '%s sends the request and answers as its twin does',
    async (name, tool) => {
      const other = twin(name);
      const example = exampleOf(tool.response);
      const input = argumentsFor(tool);
      for (const body of [example, withExtras(example), {}, null, [example]]) {
        const server = await outcome(tool, input, body);
        const client = await outcome(other, input, body);
        if (REFINED.has(name) && body !== example && 'result' in client) continue;
        expect(client).toEqual(server);
      }
    },
  );

  it.each(direct.map((tool) => [tool.name, tool] as const))(
    '%s refuses the answers its twin refuses',
    async (name, tool) => {
      const other = twin(name);
      for (const status of [400, 403, 404, 412, 500]) {
        const body = { type: 'about:blank', title: 'refused', detail: 'insufficient_scope' };
        const input = argumentsFor(tool);
        expect(await outcome(other, input, body, status)).toEqual(
          await outcome(tool, input, body, status),
        );
      }
    },
  );

  it.each(direct.map((tool) => [tool.name, tool] as const))(
    '%s takes and refuses the arguments its twin does',
    (name, tool) => {
      const other = twin(name);
      const valid = argumentsFor(tool);
      const probes: unknown[] = [
        valid,
        {},
        { ...valid, unlisted_member: 1 },
        { ...valid, id: 'x'.repeat(2_000) },
        { ...valid, limit: 0 },
        { ...valid, limit: 1_000 },
        { ...valid, limit: 5 },
        { ...valid, cursor: 'c'.repeat(1_025) },
        null,
        'text',
      ];
      for (const probe of probes) {
        expect(other.input.safeParse(probe).success, JSON.stringify(probe)).toBe(
          tool.input.safeParse(probe).success,
        );
      }
    },
  );

  it.each(
    direct
      .filter((tool) => argumentsFor(tool).id !== undefined)
      .map((tool) => [tool.name, tool] as const),
  )('%s keeps a hostile id out of the path, as its twin does', async (name, tool) => {
    const other = twin(name);
    for (const id of ['..', '.', 'a/b', '%2f', '?x=1', '#', '../x', '']) {
      const input = { ...argumentsFor(tool), id };
      const server = await outcome(tool, input, {});
      const client = await outcome(other, input, {});
      expect(client).toEqual(server);
      for (const request of client.requests) {
        expect(Object.values(request.params)).not.toContain(id);
      }
    }
  });
});
