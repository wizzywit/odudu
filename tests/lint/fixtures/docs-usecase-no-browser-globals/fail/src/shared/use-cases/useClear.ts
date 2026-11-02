export const stop = (handle: number): void => {
  clearTimeout(handle);
  cancelIdleCallback(handle);
};
