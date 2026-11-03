export const next = (() => {
  let n = 0;
  return () => (n += 1);
})();
