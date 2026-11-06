import type { AdminCaller, AdminRequestSpec, AdminResult } from '#/service/tool';

export interface FakeCaller extends AdminCaller {
  readonly requests: AdminRequestSpec[];
}

export function respondingWith(body: unknown, status = 200): FakeCaller {
  const requests: AdminRequestSpec[] = [];
  const result: AdminResult = { status, headers: {}, body };
  return {
    requests,
    call(request) {
      requests.push(request);
      return Promise.resolve(result);
    },
  };
}
