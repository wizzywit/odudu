import { useDrafts } from '#/shared/lib/repository/useDrafts';

export function Parts() {
  const { count } = useDrafts.getState();
  const state = useDrafts.getState();
  return count.toFixed() + String(state.count.toFixed());
}
