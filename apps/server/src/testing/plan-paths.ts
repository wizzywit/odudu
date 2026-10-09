import { type Statement, type StatementRecorder } from '#/testing/plan-capture';

export type Area = 'oidc' | 'account' | 'authn' | 'admin' | 'audit' | 'reap' | 'gateway' | 'email';

// One request or one pass, with every statement it sent.
export interface PathRun {
  readonly path: string;
  readonly area: Area;
  readonly statements: readonly Statement[];
  // What an HTTP path answered, where it was one.
  readonly status?: number;
  // Set where a statement's work is the rows it deletes: the expired rows a
  // retention rule reaches are the rows it removes, so how many it reads is
  // not a bound it can hold; that it reaches them by an index still is.
  readonly outputBound?: true;
}

// Runs one named step of a drive and keeps what it sent, so the statements
// are explained under the name a failure will be reported by.
export type Capture = <T>(path: string, area: Area, run: () => Promise<T>) => Promise<T>;

export function pathLog(recorder: StatementRecorder): {
  readonly runs: PathRun[];
  readonly capture: Capture;
} {
  const runs: PathRun[] = [];
  const capture: Capture = async (path, area, run) => {
    const { result, statements } = await recorder.record(run);
    const status =
      typeof result === 'object' && result !== null && 'statusCode' in result
        ? Number(result.statusCode)
        : undefined;
    runs.push({ path, area, statements, ...(status === undefined ? {} : { status }) });
    return result;
  };
  return { runs, capture };
}
