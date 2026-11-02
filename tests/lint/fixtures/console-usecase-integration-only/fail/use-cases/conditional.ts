declare function useState<T>(initial: T): [T, (next: T) => void];

export function useRow(id: string | null) {
  const [busy] = useState(false);
  return {
    id,
    label: id === null ? 'none' : id,
    action: busy ? undefined : () => id,
    nested: { phase: busy ? 'saving' : 'idle' },
  };
}

export const useBadge = (count: number) => ({ shown: count > 0 ? count : null });

export function useVariable(busy: boolean) {
  const shown = busy ? 'saving' : 'idle';
  const pair = [busy ? 1 : 2, 3];
  return { shown, pair };
}

export function useArgument(busy: boolean) {
  return { text: String(busy ? 1 : 2), note: `is ${busy ? 'on' : 'off'}` };
}

export function useDirect(busy: boolean) {
  return busy ? 1 : 2;
}
