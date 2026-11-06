import { type FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';
import { runAfterCommit } from '#/view/routes/idempotent-route';

describe('runAfterCommit', () => {
  it('runs every effect, logs one that throws and goes on', () => {
    const logged: unknown[] = [];
    const request = {
      log: {
        error: (fields: unknown) => {
          logged.push(fields);
        },
      },
    } as unknown as FastifyRequest;
    const ran: string[] = [];
    runAfterCommit(
      [
        () => {
          ran.push('a');
        },
        () => {
          throw new Error('cache gone');
        },
        () => {
          ran.push('c');
        },
      ],
      request,
    );
    expect(ran).toEqual(['a', 'c']);
    expect(logged).toHaveLength(1);
  });
});
