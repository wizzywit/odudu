declare function describeGroup(name: string): string;
declare function useState<T>(initial: T): [T, (next: T) => void];

// Wiring only: a service builds the text, the hook holds the state.
export function useGroup(name: string): string {
  const [shown] = useState(describeGroup(name));
  if (shown === '') return 'none';
  console.error('the group read failed unexpectedly here');
  throw new Error('a group could not be read from the server');
}

export const useOther = (): number => 1;
