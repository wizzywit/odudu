import { expect, it } from 'vitest';

const modules = import.meta.glob<string>('./*.module.css', {
  query: '?raw',
  import: 'default',
  eager: true,
});

it('casts shadows only from the toast and dialog layers', () => {
  const casting = Object.entries(modules).flatMap(([file, css]) =>
    [...css.matchAll(/([^{}]+)\{[^}]*box-shadow:/gu)].map(
      ([, selector = '']) => `${file.replace('./', '')} ${selector.trim()}`,
    ),
  );
  expect(Object.keys(modules).length).toBeGreaterThan(10);
  expect(casting.sort()).toEqual([
    'AppShell.module.css .sheet',
    'DialogFrame.module.css .modal',
    'Toasts.module.css .toast',
  ]);
});
