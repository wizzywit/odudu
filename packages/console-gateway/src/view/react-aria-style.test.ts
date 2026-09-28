import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SHELL_CSP } from '#/view/spa';

// React Aria prepends <style> elements whose text is fixed in its source.
// The shell's CSP admits each by hash, so the hashes are recomputed here
// from the version the console is built with: an upgrade that changes a
// text, or adds an injection site, fails this rather than the page.
const CONSOLE_PACKAGE = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  '..',
  'apps',
  'admin-console',
  'package.json',
);

function packageDir(from: string, name: string): string {
  return dirname(createRequire(from).resolve(`${name}/package.json`));
}

const RAC_DIR = packageDir(CONSOLE_PACKAGE, 'react-aria-components');
const REACT_ARIA_DIR = packageDir(join(RAC_DIR, 'package.json'), 'react-aria');

const INJECTORS = [
  'dist/private/interactions/usePress.mjs',
  'dist/private/overlays/usePreventScroll.mjs',
] as const;

function modules(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.mjs'))
    .map((file) => file.split('\\').join('/'));
}

function injectingModules(root: string): string[] {
  return modules(join(root, 'dist'))
    .map((file) => `dist/${file}`)
    .filter((file) =>
      /createElement\(['"]style['"]\)/u.test(readFileSync(join(root, file), 'utf8')),
    )
    .sort();
}

function escapeRegExp(text: string): string {
  return text.replace(/[$^.*+?()[\]{}|\\]/gu, '\\$&');
}

// The text a module assigns to its style element, as its template literal
// evaluates: each `${…VAR}` replaced by that module-level string constant.
function injectedText(source: string): string {
  const assignments = [...source.matchAll(/style\.textContent = `([^`]*)`\.trim\(\)/gu)];
  expect(assignments).toHaveLength(1);
  const template = assignments[0]?.[1] ?? '';
  return template
    .replace(/\$\{([^}]+)\}/gu, (_match, name: string) => {
      const constant = new RegExp(`const ${escapeRegExp(name)} = '([^']*)';`, 'u');
      const value = constant.exec(source)?.[1];
      if (value === undefined) throw new Error(`no string constant ${name} in the module`);
      return value;
    })
    .trim();
}

function hashSource(text: string): string {
  return `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`;
}

function styleSources(csp: string): string[] {
  const directive = csp
    .split(';')
    .map((part) => part.trim().split(/\s+/u))
    .find(([name]) => name === 'style-src');
  return directive?.slice(1) ?? [];
}

describe("the shell's style-src and the React Aria it is built with", () => {
  it('finds no style injection outside the modules it hashes', () => {
    expect(injectingModules(RAC_DIR)).toEqual([]);
    expect(injectingModules(REACT_ARIA_DIR)).toEqual([...INJECTORS].sort());
  });

  it("names the pressable style's hash", () => {
    const text = injectedText(readFileSync(join(REACT_ARIA_DIR, INJECTORS[0]), 'utf8'));
    expect(text).toBe(
      '@layer {\n  [data-react-aria-pressable] {\n    touch-action: pan-x pan-y pinch-zoom;\n  }\n}',
    );
    expect(styleSources(SHELL_CSP)).toContain(hashSource(text));
  });

  it("names the hash of usePreventScroll's iOS WebKit style", () => {
    const text = injectedText(readFileSync(join(REACT_ARIA_DIR, INJECTORS[1]), 'utf8'));
    expect(text).toBe('@layer {\n  * {\n    overscroll-behavior: contain;\n  }\n}');
    expect(styleSources(SHELL_CSP), `usePreventScroll's style: ${hashSource(text)}`).toContain(
      hashSource(text),
    );
  });

  it('admits nothing else inline', () => {
    const hashes = INJECTORS.map((file) =>
      hashSource(injectedText(readFileSync(join(REACT_ARIA_DIR, file), 'utf8'))),
    );
    expect(styleSources(SHELL_CSP)).toEqual(["'self'", ...hashes]);
  });
});
