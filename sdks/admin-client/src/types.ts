import type {
  Client,
  ClientPathsWithMethod,
  FetchResponse,
  MaybeOptionalInit,
} from 'openapi-fetch';

export type TokenSource = string | (() => Promise<string>);

export interface ClientOptions {
  /** The origin and base path of the server, such as `https://id.example.com`. */
  baseUrl: string;
  /** The tenant every call is made in; a path never repeats it. */
  tenant: string;
  /** An access token, or a function that returns one. It is called for every request. */
  token: TokenSource;
  fetch?: typeof fetch;
  /** Waits between retries; replaced in tests. */
  sleep?: (ms: number) => Promise<void>;
}

export interface PageRequest {
  limit: number;
  cursor?: string;
}

export interface Page<T> {
  items: readonly T[];
  /** The cursor of the next page; the admin API calls it `next`. */
  next?: string | null;
  /** The cursor of the next page; the me API calls it `next_cursor`. */
  next_cursor?: string | null;
}

export interface IterateOptions {
  /** Items asked for per request. Default 50. */
  pageLimit?: number;
  /** Items after which iteration stops, whatever the server still holds. Default 10,000. */
  maxItems?: number;
}

type DropTenantPath<Parameters> = Parameters extends { path: infer Path }
  ? Omit<Parameters, 'path'> &
      (keyof Omit<Path, 'tenant'> extends never ? { path?: never } : { path: Omit<Path, 'tenant'> })
  : Parameters;

type TenantOperation<Operation> = Operation extends { parameters: infer Parameters }
  ? Omit<Operation, 'parameters'> & { parameters: DropTenantPath<Parameters> }
  : Operation;

/** The generated paths with the `tenant` path parameter taken away from every operation. */
export type TenantPaths<P> = {
  [Route in keyof P]: {
    [Method in keyof P[Route]]: Method extends 'parameters'
      ? P[Route][Method]
      : TenantOperation<P[Route][Method]>;
  };
};

type RequiredKeysOf<T> = {
  [K in keyof T]-?: Pick<T, K> extends Required<Pick<T, K>> ? K : never;
}[keyof T];

type InitParam<Init> =
  RequiredKeysOf<Init> extends never
    ? [(Init & Record<string, unknown>)?]
    : [Init & Record<string, unknown>];

type Success<Response> = Extract<Response, { error?: never }>;

type OperationOf<P, Path extends keyof P, Method extends string> = Method extends keyof P[Path]
  ? P[Path][Method]
  : never;

type Call<P, Method extends 'get' | 'put' | 'post' | 'patch' | 'delete'> = <
  Path extends ClientPathsWithMethod<Client<TenantPaths<P>>, Method>,
  Init extends MaybeOptionalInit<TenantPaths<P>[Path], Method & keyof TenantPaths<P>[Path]>,
>(
  url: Path,
  ...init: InitParam<Init>
) => Promise<
  Success<
    OperationOf<TenantPaths<P>, Path, Method> extends Record<string | number, unknown>
      ? FetchResponse<OperationOf<TenantPaths<P>, Path, Method>, Init, 'application/json'>
      : never
  >
>;

/**
 * The generated paths as calls. A call resolves with the success response and
 * throws a `ProblemError` for any other.
 */
export interface TenantClient<P> {
  GET: Call<P, 'get'>;
  POST: Call<P, 'post'>;
  PUT: Call<P, 'put'>;
  PATCH: Call<P, 'patch'>;
  DELETE: Call<P, 'delete'>;
}
