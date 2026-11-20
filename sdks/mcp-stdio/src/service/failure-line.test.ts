import { describe, expect, it } from 'vitest';
import { failureLine } from '#/service/failure-line';

describe('the line a failure leaves on standard error', () => {
  it('carries the error’s name, a cleaned message and the correlation id', () => {
    const line = failureLine('tool failed', 'req-1', new TypeError('boom\nsecond line'));
    expect(line).toBe('odudu mcp: tool failed (req-1): TypeError: boom second line');
    expect(line).not.toContain('\n');
  });

  it('strips a query from an address and shortens a long opaque run, whatever they were', () => {
    const token = 'A'.repeat(60);
    const line = failureLine(
      'tool failed',
      'req-2',
      new Error(`GET https://id.example.com/x?code=SECRETCODE&state=s failed with ${token}`),
    );
    expect(line).not.toMatch(/SECRETCODE|state=s|AAAAAAAAAA/u);
    expect(line).toContain('https://id.example.com/x');
  });

  it('bounds the message', () => {
    const line = failureLine('tool failed', 'r', new Error('word '.repeat(200)));
    expect(line.length).toBeLessThan(330);
  });

  it('names a thrown value that is not an error without printing it', () => {
    expect(failureLine('tool failed', 'r', { secret: 'x' })).toBe(
      'odudu mcp: tool failed (r): non-error value',
    );
  });

  it('works with no cause', () => {
    expect(failureLine('tool timed out', 'r')).toBe('odudu mcp: tool timed out (r)');
  });
});
