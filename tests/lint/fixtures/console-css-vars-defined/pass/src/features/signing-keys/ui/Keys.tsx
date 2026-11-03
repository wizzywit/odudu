export function Keys({ width }: { width: number }) {
  return (
    <div style={{ '--gap': `${String(width)}px`, padding: 'var(--gap)' }}>
      <span style={{ color: 'var(--ink-danger)' }}>x</span>
    </div>
  );
}

export function place(element: HTMLElement): void {
  element.style.setProperty('--offset', '3px');
  element.style.margin = 'var(--offset)';
}
