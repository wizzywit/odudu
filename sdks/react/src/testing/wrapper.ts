import { createElement, type ReactNode } from 'react';
import { OduduProvider } from '#/ui/OduduProvider';
import type { Mode } from '#/types';

export function providerFor(mode: Mode): (props: { children: ReactNode }) => ReactNode {
  return function Wrapper({ children }) {
    return createElement(OduduProvider, { mode, children });
  };
}
