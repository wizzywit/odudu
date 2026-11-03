// A feature's code that did not arrive, most often because the console was
// redeployed and the chunk this page knows by name is gone.
export class ChunkLoadError extends Error {
  constructor(cause: unknown) {
    super('a part of the console could not be loaded', { cause });
    this.name = 'ChunkLoadError';
  }
}
