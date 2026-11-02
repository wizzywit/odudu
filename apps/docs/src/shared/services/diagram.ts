// Every colour is a custom property the site already sets for both colour
// modes, so a diagram follows the site's toggle and not the system's setting.
export const INK = {
  ink: 'var(--ink-primary)',
  muted: 'var(--ink-muted)',
  accent: 'var(--signal-active-ink)',
};

export type Tone = 'panel' | 'accent';
export type Ink = keyof typeof INK;

export const SURFACE: Record<Tone, { fill: string; stroke: string }> = {
  panel: { fill: 'var(--surface-sunken)', stroke: 'var(--border-strong)' },
  accent: { fill: 'var(--signal-active)', stroke: 'var(--signal-active-ink)' },
};

export const WIDTH = 340;

export function vertical(x: number, from: number, to: number): string {
  return `M${String(x)} ${String(from)} L${String(x)} ${String(to)}`;
}
