export const BOOT_READ_TIMEOUT_MS = 5_000;

export interface BootLogger {
  warn(details: Record<string, unknown>, message: string): void;
}

// A check made while the server starts. A read that fails or outlasts
// `timeoutMs` is logged and never stops the server from starting.
export async function warnFromBoundedRead<T>(
  find: () => Promise<T>,
  messageFor: (found: T) => string | null,
  logger: BootLogger,
  wording: { readonly slow: string; readonly failed: string },
  timeoutMs = BOOT_READ_TIMEOUT_MS,
): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const slow = new Promise<'slow'>((resolve) => {
    timer = setTimeout(() => {
      resolve('slow');
    }, timeoutMs);
  });
  try {
    const found = await Promise.race([find(), slow]);
    if (found === 'slow') {
      logger.warn({}, wording.slow);
      return;
    }
    const message = messageFor(found);
    if (message !== null) logger.warn({}, message);
  } catch (err) {
    logger.warn({ err }, wording.failed);
  } finally {
    clearTimeout(timer);
  }
}
