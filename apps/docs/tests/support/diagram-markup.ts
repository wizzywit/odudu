import { isValidElement, type ReactNode } from 'react';
import { DRAWINGS, type DiagramName } from '#docs/src/shared/ui/Diagram/diagrams.tsx';

// The elements a node draws, components expanded, as markup. No renderer is
// needed: a drawing is only function components over SVG tags.
export function markup(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(markup).join('');
  if (!isValidElement(node)) return '';
  const { children, ...attributes } = node.props as Record<string, unknown> & {
    children?: ReactNode;
  };
  if (typeof node.type === 'function') {
    const component = node.type as (props: object) => ReactNode;
    return markup(component(node.props as object));
  }
  if (typeof node.type !== 'string') return markup(children);
  const tag = node.type;
  const shown = Object.entries(attributes)
    .map(([key, value]) => ` ${key}="${String(value)}"`)
    .join('');
  return `<${tag}${shown}>${markup(children)}</${tag}>`;
}

export const drawn = (name: DiagramName, head = 'h'): string => markup(DRAWINGS[name].draw(head));

// The words each text of a drawing carries, in the order it draws them.
export function declaredTexts(name: DiagramName): string[] {
  return [...drawn(name).matchAll(/<text[^>]*>([^<]*)<\/text>/gu)].map((match) => match[1] ?? '');
}
