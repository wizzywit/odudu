// What the shell's width is, and when it changes: the width its own container
// queries answer to, which is what decides whether the panel has a column of
// its own or lies over the page.
export function currentShellWidth(): number {
  const shell = document.querySelector('[data-shell]');
  return shell instanceof HTMLElement && shell.clientWidth > 0
    ? shell.clientWidth
    : window.innerWidth;
}

export function watchShellWidth(onChange: (width: number) => void): () => void {
  const shell = document.querySelector('[data-shell]');
  if (!(shell instanceof HTMLElement) || typeof ResizeObserver === 'undefined') {
    const resized = (): void => {
      onChange(window.innerWidth);
    };
    window.addEventListener('resize', resized);
    return () => {
      window.removeEventListener('resize', resized);
    };
  }
  const watch = new ResizeObserver(() => {
    onChange(currentShellWidth());
  });
  watch.observe(shell);
  return () => {
    watch.disconnect();
  };
}
