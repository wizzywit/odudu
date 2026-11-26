import { useEffect, useState } from 'react';
import { currentShellWidth, watchShellWidth } from '#/widgets/assistant-panel/adapter/shellWidth';
import { docked } from '#/widgets/assistant-panel/services/layout';

// Whether the panel has a column beside the page, or lies over it. Read as
// the shell lays out, and again whenever the shell is resized.
export function useDocked(): boolean {
  const [width, setWidth] = useState(currentShellWidth);
  useEffect(() => watchShellWidth(setWidth), []);
  return docked(width);
}
