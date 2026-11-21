export const DEFAULT_STORE_WARNING_CODE = 'ODUDU_NEXT_DEFAULT_STORE';

export const DEFAULT_STORE_WARNING =
  'The default session store keeps sessions in the memory of this process: they are lost when it ' +
  'restarts and are not shared with another process or serverless instance. Pass a `store` to ' +
  'createOduduHandlers to run more than one.';

// Said once per process, and only for a production build, where a lost or
// unshared session is a defect and not a development convenience.
export function shouldWarnAboutDefaultStore(nodeEnv: string | undefined, warned: boolean): boolean {
  return nodeEnv === 'production' && !warned;
}
