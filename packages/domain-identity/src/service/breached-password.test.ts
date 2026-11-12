import { describe, expect, it } from 'vitest';
import {
  BREACH_CHECK_UNAVAILABLE,
  BREACHED_PASSWORD,
  BreachedLookupFailed,
  breachedHash,
  judgeBreached,
  type BreachedPasswordSource,
} from '#/service/breached-password';

// SHA-1("password") is the best-known entry of the public corpus.
const PASSWORD_SHA1 = '5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8';

describe('breachedHash', () => {
  it('splits the SHA-1 into five characters and thirty-five', () => {
    expect(breachedHash('password')).toEqual({
      prefix: PASSWORD_SHA1.slice(0, 5),
      suffix: PASSWORD_SHA1.slice(5),
    });
  });

  it('hashes the NFC form, the one that is stored', () => {
    expect(breachedHash('é')).toEqual(breachedHash('é'));
  });
});

function source(result: boolean | Error): BreachedPasswordSource & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    isBreached: (password) => {
      asked.push(password);
      return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
    },
  };
}

function judge(
  check: 'off' | 'dataset' | 'remote',
  onError: 'open' | 'closed',
  dataset: BreachedPasswordSource,
  remote: BreachedPasswordSource,
) {
  return judgeBreached(
    { check, onError },
    { dataset: () => dataset, remote: () => remote },
    'candidate',
  );
}

describe('judgeBreached', () => {
  it('asks no source when the check is off', async () => {
    const dataset = source(true);
    const remote = source(true);
    expect(await judge('off', 'closed', dataset, remote)).toEqual({
      audit: 'off',
      violations: [],
    });
    expect([...dataset.asked, ...remote.asked]).toEqual([]);
  });

  it('asks only the source the tenant chose', async () => {
    const dataset = source(false);
    const remote = source(true);
    expect((await judge('dataset', 'open', dataset, remote)).audit).toBe('passed');
    expect((await judge('remote', 'open', dataset, remote)).audit).toBe('breached');
    expect(dataset.asked).toHaveLength(1);
    expect(remote.asked).toHaveLength(1);
  });

  it('refuses a breached password with the breached rule', async () => {
    expect(await judge('dataset', 'open', source(true), source(false))).toEqual({
      audit: 'breached',
      violations: [BREACHED_PASSWORD],
    });
  });

  it('accepts when the lookup failed and the tenant fails open', async () => {
    const failing = source(new BreachedLookupFailed('timed out'));
    expect(await judge('remote', 'open', source(false), failing)).toEqual({
      audit: 'error_open',
      violations: [],
    });
  });

  it('refuses with the unavailable rule when it failed and the tenant fails closed', async () => {
    const failing = source(new BreachedLookupFailed('timed out'));
    expect(await judge('remote', 'closed', source(false), failing)).toEqual({
      audit: 'error_closed',
      violations: [BREACH_CHECK_UNAVAILABLE],
    });
  });

  it('lets any other failure through, which is a defect and not a failed lookup', async () => {
    await expect(
      judge('dataset', 'open', source(new Error('connection reset')), source(false)),
    ).rejects.toThrow('connection reset');
  });

  it('names the two refusals by distinct stable rules', () => {
    expect([BREACHED_PASSWORD.rule, BREACH_CHECK_UNAVAILABLE.rule]).toEqual([
      'breached-password',
      'breach-check-unavailable',
    ]);
  });
});
